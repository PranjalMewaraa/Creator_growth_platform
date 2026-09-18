import { createLogger } from '@cgp/config';
import type { QueuedJobData } from '@cgp/contracts';
import { jobs, scoped, type Database } from '@cgp/db';
import { createTestDatabase, createTestWorkspace, insertMeteringRates } from '@cgp/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { estimateGeneration, findJob, startGeneration } from './generate';
import { generators } from './generators/definitions';
import type { Queues } from './queues';

const log = createLogger({ service: 'test', level: 'silent' });

/** Records what would be enqueued, so these tests need no Redis. */
function recordingQueues() {
  const added: Array<{ queue: string; name: string; data: QueuedJobData }> = [];
  const queue = (name: string) => ({
    add: (jobName: string, data: QueuedJobData) => {
      added.push({ queue: name, name: jobName, data });
      return Promise.resolve();
    },
  });
  const queues = {
    inference: queue('inference'),
    render: queue('render'),
    publish: queue('publish'),
  } as unknown as Queues;
  return { queues, added };
}

let db: Database;

beforeAll(async () => {
  db = await createTestDatabase();
  await insertMeteringRates(db);
});

afterAll(async () => {
  await db.close();
});

const intent = { intentText: 'Three reasons to switch to cold brew' };

describe('estimateGeneration', () => {
  it('prices with the rates in force and names their version', async () => {
    const result = await estimateGeneration(db, generators, 'thumbnail_set', intent);
    expect(result).toMatchObject({ ok: true, estimate: { credits: 36 }, ratesVersion: 1 });
  });

  it('knows only registered generators', async () => {
    expect(await estimateGeneration(db, generators, 'podcast', intent)).toEqual({
      ok: false,
      reason: 'unknown_generator',
    });
  });

  it('returns input issues rather than throwing', async () => {
    const result = await estimateGeneration(db, generators, 'script', {});
    expect(result).toMatchObject({ ok: false, reason: 'invalid_input' });
  });
});

describe('startGeneration', () => {
  it('holds the estimate, stores the parsed input and enqueues on the class queue', async () => {
    const workspaceId = await createTestWorkspace(db, { credits: 100, videoSeconds: 30 });
    const { queues, added } = recordingQueues();

    const result = await startGeneration(
      { db, queues, log, registry: generators },
      { workspaceId, generatorKey: 'video', input: { ...intent, sceneCount: 2 } },
    );

    expect(result).toMatchObject({
      ok: true,
      job: { status: 'QUEUED', jobClass: 'render', held: { credits: 0, videoSeconds: 16 } },
    });
    if (!result.ok) return;
    expect(added).toEqual([
      {
        queue: 'render',
        name: 'video',
        data: { jobId: result.job.id, correlationId: result.job.id },
      },
    ]);
    const workspace = await scoped(db, workspaceId).workspace();
    expect(workspace?.videoSecondsBalance).toBe(14);

    const stored = await findJob(db, workspaceId, result.job.id);
    expect(stored?.status).toBe('QUEUED');
  });

  it('creates nothing when the balance cannot cover the estimate', async () => {
    const workspaceId = await createTestWorkspace(db, { credits: 5 });
    const { queues, added } = recordingQueues();

    const result = await startGeneration(
      { db, queues, log, registry: generators },
      { workspaceId, generatorKey: 'script', input: intent },
    );

    expect(result).toEqual({ ok: false, reason: 'insufficient_credits' });
    expect(added).toEqual([]);
    expect(await scoped(db, workspaceId).select(jobs)).toEqual([]);
  });

  it('creates nothing for invalid input', async () => {
    const workspaceId = await createTestWorkspace(db, { credits: 100 });
    const { queues, added } = recordingQueues();
    const result = await startGeneration(
      { db, queues, log, registry: generators },
      { workspaceId, generatorKey: 'image', input: { ...intent, count: 0 } },
    );
    expect(result).toMatchObject({ ok: false, reason: 'invalid_input' });
    expect(added).toEqual([]);
  });
});

describe('findJob', () => {
  it('never shows a job from another workspace', async () => {
    const owner = await createTestWorkspace(db, { credits: 10 });
    const other = await createTestWorkspace(db, { credits: 10 });
    const { queues } = recordingQueues();
    const result = await startGeneration(
      { db, queues, log, registry: generators },
      { workspaceId: owner, generatorKey: 'caption_set', input: intent },
    );
    if (!result.ok) throw new Error('expected a job');

    expect(await findJob(db, owner, result.job.id)).toBeDefined();
    expect(await findJob(db, other, result.job.id)).toBeUndefined();
    expect(await findJob(db, owner, 'not-a-uuid')).toBeUndefined();
  });
});
