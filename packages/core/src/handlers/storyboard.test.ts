import { createFakeModeration, createImageAdapters, createMemoryStore } from '@cgp/adapters';
import { createLogger } from '@cgp/config';
import type { ImageAdapter, QueuedJobData } from '@cgp/contracts';
import { creditLedger, outputs, scoped, type Database } from '@cgp/db';
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
import { jobOutputs } from '../studio';
import { createStoryboardHandler, storyboardScenes } from './storyboard';

const log = createLogger({ service: 'test', level: 'silent' });
const queues = {
  inference: { add: () => Promise.resolve() },
  render: { add: () => Promise.resolve() },
  publish: { add: () => Promise.resolve() },
} as unknown as Queues;

let db: Database;
let store: ReturnType<typeof createMemoryStore>;

beforeAll(async () => {
  db = await createTestDatabase();
  await insertMeteringRates(db);
  await seedTestCatalog(db);
  store = createMemoryStore();
});

afterAll(async () => {
  await db.close();
});

function handlers(adapters: Record<string, ImageAdapter> = createImageAdapters('fake')) {
  return createStoryboardHandler({
    db,
    registry: generators,
    adapters,
    planner: undefined,
    moderation: createFakeModeration(),
    store,
    costInr: () => 0,
    providerLabel: 'fake',
  });
}

async function drawStoryboard(sceneCount = 3) {
  const workspaceId = await createTestWorkspace(db, { credits: 200, videoSeconds: 120 });
  await addTestProfile(db, workspaceId);
  const started = await startGeneration(
    {
      db,
      queues,
      log,
      registry: generators,
      compile: { rewriters: [] },
      moderation: createFakeModeration(),
    },
    {
      workspaceId,
      generatorKey: 'storyboard',
      input: { intentText: 'A morning in the roastery', targetPlatform: 'instagram', sceneCount },
    },
  );
  if (!started.ok) throw new Error(started.reason);
  const result = await processJob({ db, handlers: handlers(), log }, {
    jobId: started.job.id,
    correlationId: 'c',
  } satisfies QueuedJobData);
  return { workspaceId, started, result };
}

describe('the storyboard', () => {
  it('draws one frame per scene and charges credits, not video seconds', async () => {
    const { workspaceId, started, result } = await drawStoryboard(3);
    expect(result).toBe('settled');

    // Three frames at the image rate, and not a second of video.
    expect(started.job.held).toEqual({ credits: 45, videoSeconds: 0 });
    expect(await findJob(db, workspaceId, started.job.id)).toMatchObject({
      settled: { credits: 45, videoSeconds: 0 },
    });

    const [output] = await jobOutputs(db, workspaceId, started.job.id, store);
    expect(output?.storyboard).toHaveLength(3);
    expect(output?.storyboard?.map((frame) => frame.index)).toEqual([0, 1, 2]);
    for (const frame of output?.storyboard ?? []) {
      expect(frame.url).toContain(`/storyboards/${started.job.id}/${frame.index}.`);
    }
  });

  it('keeps the scene prompts, so filming it shoots what was approved', async () => {
    const { workspaceId } = await drawStoryboard(2);
    const [output] = await scoped(db, workspaceId).select(outputs);
    const approved = await storyboardScenes(db, workspaceId, output?.id ?? '');
    expect(approved).toHaveLength(2);
    expect(approved?.[0]).toContain('Scene 1');
  });

  it('costs a fraction of the reel it previews', async () => {
    const { workspaceId } = await drawStoryboard(3);
    const ledger = await scoped(db, workspaceId).select(creditLedger);
    // Credits only: the workspace is granted video seconds as well, and a storyboard spends
    // none of them, which is the point of it.
    const credits = ledger.filter((entry) => entry.currency === 'credits');
    expect(credits.map((entry) => [entry.reason, entry.delta])).toEqual([
      ['grant', 200],
      ['hold', -45],
      ['settle', 0],
    ]);
    expect(ledger.filter((entry) => entry.currency === 'video_seconds')).toHaveLength(1);
  });

  it('refunds in full when every frame is refused', async () => {
    const refusing: ImageAdapter = {
      key: 'gemini-flash-lite-image',
      generate: () => Promise.resolve({ images: [], usage: { inputTokens: 0, outputTokens: 0 } }),
    };
    const workspaceId = await createTestWorkspace(db, { credits: 100 });
    await addTestProfile(db, workspaceId);
    const started = await startGeneration(
      {
        db,
        queues,
        log,
        registry: generators,
        compile: { rewriters: [] },
        moderation: createFakeModeration(),
      },
      {
        workspaceId,
        generatorKey: 'storyboard',
        input: { intentText: 'A roastery', targetPlatform: 'instagram', sceneCount: 1 },
      },
    );
    if (!started.ok) throw new Error(started.reason);
    const result = await processJob(
      { db, handlers: handlers({ 'gemini-flash-lite-image': refusing }), log },
      { jobId: started.job.id, correlationId: 'c' },
    );
    expect(result).toBe('refunded');
    expect((await scoped(db, workspaceId).workspace())?.creditBalance).toBe(100);
  });
});
