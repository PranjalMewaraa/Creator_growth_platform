import {
  createFakeModeration,
  createImageAdapters,
  createMemoryStore,
  createTextAdapters,
} from '@cgp/adapters';
import { createLogger } from '@cgp/config';
import type { ModerationAdapter, ObjectStore, QueuedJobData } from '@cgp/contracts';
import { creditLedger, moderationEvents, outputs, scoped, type Database } from '@cgp/db';
import {
  addTestProfile,
  createTestDatabase,
  createTestWorkspace,
  insertMeteringRates,
  seedTestCatalog,
} from '@cgp/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { findJob, startGeneration } from '../generate';
import { generators } from '../generators/definitions';
import { processJob } from '../process';
import type { Queues } from '../queues';
import { createImageHandlers } from './image';
import { createTextHandlers } from './text';

// WP16: what a provider returns is checked before any of it is kept. These tests make the
// check say no, or fail, and watch the credits come back.

const log = createLogger({ service: 'test', level: 'silent' });

function recordingQueues(): Queues {
  const queue = () => ({ add: () => Promise.resolve() });
  return { inference: queue(), render: queue(), publish: queue() } as unknown as Queues;
}

const ALLOWED = { allowed: true, flagged: [] };
const BLOCKED = { allowed: false, flagged: [{ category: 'violence' as const, score: 1 }] };

/** Passes the compiled prompt, refuses what the generator made. */
const blocksOutput = (kind: 'text' | 'image'): ModerationAdapter => ({
  key: 'stub',
  // The pre check sees the compiled prompt, which never says "fake"; everything the fake
  // generator writes does, so this refuses the output and passes the prompt.
  checkText: (text) =>
    Promise.resolve(kind === 'text' && text.includes('fake') ? BLOCKED : ALLOWED),
  checkImage: () => Promise.resolve(kind === 'image' ? BLOCKED : ALLOWED),
});

/** Passes the compiled prompt, then the checker itself goes down. */
const failsOnOutput: ModerationAdapter = {
  key: 'stub',
  checkText: () => Promise.resolve(ALLOWED),
  checkImage: () => Promise.reject(new Error('moderation endpoint down')),
};

let db: Database;

beforeAll(async () => {
  db = await createTestDatabase();
  await insertMeteringRates(db);
  await seedTestCatalog(db);
});

afterAll(async () => {
  await db.close();
});

const intent = { intentText: 'Three reasons to switch to cold brew' };

function deps() {
  return {
    db,
    queues: recordingQueues(),
    log,
    registry: generators,
    compile: { rewriters: [] },
    moderation: createFakeModeration(),
  };
}

async function workspace() {
  const id = await createTestWorkspace(db, { credits: 100 });
  await addTestProfile(db, id);
  return id;
}

function textHandlers(moderation: ModerationAdapter) {
  return createTextHandlers({
    db,
    registry: generators,
    adapters: createTextAdapters('fake'),
    moderation,
    publishDelta: () => Promise.resolve(),
    costInr: () => 0,
    providerLabel: 'fake',
  });
}

function imageHandlers(moderation: ModerationAdapter, store: ObjectStore) {
  return createImageHandlers({
    db,
    registry: generators,
    adapters: createImageAdapters('fake'),
    moderation,
    store,
    costInr: () => 0,
    providerLabel: 'fake',
  });
}

async function run(
  generatorKey: string,
  input: Record<string, unknown>,
  handlers: Record<string, ReturnType<typeof textHandlers>[string]>,
) {
  const workspaceId = await workspace();
  const started = await startGeneration(deps(), { workspaceId, generatorKey, input });
  if (!started.ok) throw new Error(started.reason);
  const result = await processJob({ db, handlers, log }, {
    jobId: started.job.id,
    correlationId: started.job.id,
  } satisfies QueuedJobData);
  return { workspaceId, jobId: started.job.id, result };
}

describe('moderation post check', () => {
  it('blocks generated text, keeps nothing, and refunds in full with the category', async () => {
    const { workspaceId, jobId, result } = await run(
      'hook_title_set',
      intent,
      textHandlers(blocksOutput('text')),
    );
    expect(result).toBe('refunded');

    const job = await findJob(db, workspaceId, jobId);
    expect(job).toMatchObject({
      status: 'BLOCKED',
      settled: null,
      error: { code: 'MODERATION_BLOCKED', category: 'violence' },
    });
    expect(await scoped(db, workspaceId).select(outputs)).toEqual([]);

    const ledger = await scoped(db, workspaceId).select(creditLedger);
    expect(ledger.map((entry) => [entry.reason, entry.delta])).toEqual([
      ['grant', 100],
      ['hold', -1],
      ['refund', 1],
    ]);
  });

  it('blocks a generated picture before it is ever stored', async () => {
    const store = createMemoryStore();
    const put: string[] = [];
    const watched: ObjectStore = {
      ...store,
      put: (key, data, mimeType) => {
        put.push(key);
        return store.put(key, data, mimeType);
      },
    };
    const { workspaceId, jobId, result } = await run(
      'image',
      { ...intent, targetPlatform: 'instagram' },
      imageHandlers(blocksOutput('image'), watched),
    );

    expect(result).toBe('refunded');
    expect(put).toEqual([]);
    expect(await findJob(db, workspaceId, jobId)).toMatchObject({
      status: 'BLOCKED',
      error: { category: 'violence' },
    });
    expect(await scoped(db, workspaceId).select(outputs)).toEqual([]);
  });

  it('records the verdict against the job, whichever way it goes', async () => {
    const allowed = await run('hook_title_set', intent, textHandlers(createFakeModeration()));
    const blocked = await run('hook_title_set', intent, textHandlers(blocksOutput('text')));

    for (const [{ workspaceId, jobId }, verdict] of [
      [allowed, 'allowed'],
      [blocked, 'blocked'],
    ] as const) {
      const events = await scoped(db, workspaceId).select(moderationEvents, {
        where: (t, op) => op.eq(t.subjectType, 'job'),
      });
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ subjectId: jobId, verdict });
    }
  });

  it('releases nothing when the check itself cannot run, and charges nothing', async () => {
    const store = createMemoryStore();
    const { workspaceId, jobId, result } = await run(
      'image',
      { ...intent, targetPlatform: 'instagram' },
      imageHandlers(failsOnOutput, store),
    );

    expect(result).toBe('refunded');
    expect(await findJob(db, workspaceId, jobId)).toMatchObject({
      status: 'FAILED',
      error: { code: 'MODERATION_UNAVAILABLE' },
    });
    expect(await scoped(db, workspaceId).select(outputs)).toEqual([]);
    expect((await scoped(db, workspaceId).workspace())?.creditBalance).toBe(100);
  });
});
