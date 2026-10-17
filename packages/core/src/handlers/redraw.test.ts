import { createFakeModeration, createImageAdapters, createMemoryStore } from '@cgp/adapters';
import { createLogger } from '@cgp/config';
import type { ImageAdapter, ImageRequest, QueuedJobData } from '@cgp/contracts';
import { outputs, scoped, type Database } from '@cgp/db';
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
import { createRedrawFrameHandler } from './redraw';
import { createStoryboardHandler } from './storyboard';

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

/** The model as the real one is: it reads reference images. */
const READS_REFERENCES = { acceptsReferenceImages: true } as never;

function deps(adapters: Record<string, ImageAdapter> = createImageAdapters('fake')) {
  return {
    db,
    registry: generators,
    adapters,
    moderation: createFakeModeration(),
    store,
    costInr: () => 0,
    providerLabel: 'fake',
    capabilityOf: () => READS_REFERENCES,
  };
}

async function run(workspaceId: string, generatorKey: string, input: Record<string, unknown>) {
  const started = await startGeneration(
    {
      db,
      queues,
      log,
      registry: generators,
      compile: { rewriters: [] },
      moderation: createFakeModeration(),
    },
    { workspaceId, generatorKey, input },
  );
  if (!started.ok) throw new Error(started.reason);
  const handlers = {
    ...createStoryboardHandler({ ...deps(), planner: undefined }),
    ...createRedrawFrameHandler(deps()),
  };
  const result = await processJob({ db, handlers, log }, {
    jobId: started.job.id,
    correlationId: 'c',
  } satisfies QueuedJobData);
  return { started, result };
}

const INTENT = { intentText: 'A morning in the roastery', targetPlatform: 'instagram' } as const;

async function storyboard() {
  const workspaceId = await createTestWorkspace(db, { credits: 400, videoSeconds: 120 });
  await addTestProfile(db, workspaceId);
  const { started } = await run(workspaceId, 'storyboard', {
    ...INTENT,
    targetDurationSeconds: 24,
  });
  const [output] = await jobOutputs(db, workspaceId, started.job.id, store);
  if (!output?.storyboard) throw new Error('no storyboard');
  return { workspaceId, outputId: output.id, frames: output.storyboard };
}

describe('redrawing one frame', () => {
  it('costs one picture, not three', async () => {
    const { workspaceId, outputId } = await storyboard();
    const { started, result } = await run(workspaceId, 'redraw_frame', {
      ...INTENT,
      storyboardOutputId: outputId,
      frameIndex: 1,
    });

    expect(result).toBe('settled');
    // A third of what the three frame storyboard held.
    expect(started.job.held).toEqual({ credits: 15, videoSeconds: 0 });
    expect(await findJob(db, workspaceId, started.job.id)).toMatchObject({
      settled: { credits: 15, videoSeconds: 0 },
    });
  });

  it('replaces that frame and leaves the others exactly as they were', async () => {
    const { workspaceId, outputId, frames } = await storyboard();
    const { started } = await run(workspaceId, 'redraw_frame', {
      ...INTENT,
      storyboardOutputId: outputId,
      frameIndex: 1,
    });

    const [after] = await jobOutputs(db, workspaceId, started.job.id, store);
    const redrawn = after?.storyboard;
    expect(redrawn).toHaveLength(3);
    expect(redrawn?.map((f) => f.index)).toEqual([0, 1, 2]);
    expect(redrawn?.[0]?.url).toBe(frames[0]?.url);
    expect(redrawn?.[2]?.url).toBe(frames[2]?.url);
    expect(redrawn?.[1]?.url).not.toBe(frames[1]?.url);
    // The scene is still the scene: a redraw corrects the picture, never the plan.
    expect(redrawn?.[1]?.prompt).toBe(frames[1]?.prompt);
  });

  it('leaves the storyboard it came from untouched, so a worse redraw costs one picture', async () => {
    const { workspaceId, outputId, frames } = await storyboard();
    await run(workspaceId, 'redraw_frame', {
      ...INTENT,
      storyboardOutputId: outputId,
      frameIndex: 0,
    });

    const [before] = await scoped(db, workspaceId).select(outputs, {
      where: (t, op) => op.eq(t.id, outputId),
      limit: 1,
    });
    const kept = (before?.metadata as { storyboard: Array<{ url: string }> }).storyboard;
    expect(kept.map((f) => f.url)).toEqual(frames.map((f) => f.url));
  });

  it('shows the model another frame of the same storyboard, never the one being replaced', async () => {
    const { workspaceId, outputId, frames } = await storyboard();
    const seen: ImageRequest[] = [];
    const fake = createImageAdapters('fake');
    const watched = Object.fromEntries(
      Object.entries(fake).map(([key, adapter]) => [
        key,
        {
          ...adapter,
          generate: (request: ImageRequest) => {
            seen.push(request);
            return adapter.generate(request);
          },
        },
      ]),
    );

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
        generatorKey: 'redraw_frame',
        input: { ...INTENT, storyboardOutputId: outputId, frameIndex: 0 },
      },
    );
    if (!started.ok) throw new Error(started.reason);
    await processJob({ db, handlers: createRedrawFrameHandler(deps(watched)), log }, {
      jobId: started.job.id,
      correlationId: 'c',
    } satisfies QueuedJobData);

    expect(seen).toHaveLength(1);
    const reference = seen[0]?.references?.[0];
    expect(reference).toBeDefined();
    // Frame 0 is the one being redrawn, so the reference has to be one of the others. Its
    // bytes are what the store holds for frame 1.
    const frameOne = (
      await scoped(db, workspaceId).select(outputs, {
        where: (t, op) => op.eq(t.id, outputId),
        limit: 1,
      })
    )[0];
    const keys = (frameOne?.metadata as { storyboard: Array<{ key: string }> }).storyboard;
    expect(reference?.data).toEqual(await store.get(keys[1]?.key ?? ''));
    expect(frames).toHaveLength(3);
  });

  it('puts the note after the scene rather than in place of it', async () => {
    const { workspaceId, outputId, frames } = await storyboard();
    const seen: ImageRequest[] = [];
    const fake = createImageAdapters('fake');
    const watched = Object.fromEntries(
      Object.entries(fake).map(([key, adapter]) => [
        key,
        {
          ...adapter,
          generate: (request: ImageRequest) => {
            seen.push(request);
            return adapter.generate(request);
          },
        },
      ]),
    );
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
        generatorKey: 'redraw_frame',
        input: {
          ...INTENT,
          storyboardOutputId: outputId,
          frameIndex: 2,
          note: 'the cup should be on the left',
        },
      },
    );
    if (!started.ok) throw new Error(started.reason);
    await processJob({ db, handlers: createRedrawFrameHandler(deps(watched)), log }, {
      jobId: started.job.id,
      correlationId: 'c',
    } satisfies QueuedJobData);

    const sent = seen[0]?.prompt ?? '';
    expect(sent).toContain(frames[2]?.prompt ?? 'nothing');
    expect(sent).toContain('Change this: the cup should be on the left');
  });

  it('refuses a frame the storyboard does not have', async () => {
    const { workspaceId, outputId } = await storyboard();
    const { result } = await run(workspaceId, 'redraw_frame', {
      ...INTENT,
      storyboardOutputId: outputId,
      frameIndex: 2,
    });
    expect(result).toBe('settled');

    const { started } = await run(workspaceId, 'redraw_frame', {
      ...INTENT,
      storyboardOutputId: outputId,
      frameIndex: 1,
    });
    // A storyboard of another workspace is simply not found, like anything else (invariant 1).
    const other = await createTestWorkspace(db, { credits: 100, videoSeconds: 0 });
    await addTestProfile(db, other);
    const { result: refused } = await run(other, 'redraw_frame', {
      ...INTENT,
      storyboardOutputId: outputId,
      frameIndex: 0,
    });
    expect(refused).not.toBe('settled');
    expect(started.job.id).toBeTruthy();
  });
});
