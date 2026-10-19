import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  createFakeModeration,
  createFakeVideo,
  createImageAdapters,
  createMemoryStore,
} from '@cgp/adapters';
import { createLogger } from '@cgp/config';
import {
  AdapterError,
  type ModerationAdapter,
  type QueuedJobData,
  type VideoAdapter,
  type VideoCapability,
} from '@cgp/contracts';
import { listScenes, outputs, scoped, type Database } from '@cgp/db';
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
import { createStoryboardHandler } from './storyboard';
import { createVideoHandlers, REGENERATE_SCENE } from './video';

const log = createLogger({ service: 'test', level: 'silent' });

const clipBytes = new Uint8Array(
  readFileSync(fileURLToPath(new URL('../../../adapters/fixtures/fake-clip.mp4', import.meta.url))),
);

/** An adapter whose nth submitted clip is refused, and whose others arrive at once. */
function scripted(refuse: number[]): VideoAdapter {
  const refused = new Map<string, boolean>();
  let submitted = 0;
  return {
    key: 'veo-3.1-lite',
    submit: () => {
      submitted += 1;
      const operationId = `op-${submitted}`;
      refused.set(operationId, refuse.includes(submitted));
      return Promise.resolve({ operationId });
    },
    poll: (operationId) =>
      Promise.resolve(
        refused.get(operationId)
          ? {
              status: 'failed' as const,
              error: { code: 'SAFETY_FILTERED', message: 'no', category: 'terminal' as const },
            }
          : {
              status: 'done' as const,
              clip: {
                data: clipBytes,
                mimeType: 'video/mp4',
                durationSeconds: 8,
                width: 180,
                height: 320,
              },
            },
      ),
  };
}

function recordingQueues(): Queues {
  const queue = () => ({ add: () => Promise.resolve() });
  return { inference: queue(), render: queue(), publish: queue() } as unknown as Queues;
}

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

const intent = { intentText: 'A morning in the roastery, from beans to the first pour' };

function handlersWith(
  adapters: Record<string, VideoAdapter>,
  moderation: ModerationAdapter = createFakeModeration(),
  capabilityOf?: (adapterKey: string) => VideoCapability | undefined,
) {
  return createVideoHandlers({
    db,
    registry: generators,
    adapters,
    // No planner: the profile's deterministic fallback is used, which is a real path.
    planner: undefined,
    moderation,
    store,
    costInr: () => 0,
    providerLabel: 'fake',
    capabilityOf,
    // A renderer that is not there: the scenes are kept and no reel is built, which is the
    // path a machine without ffmpeg takes.
    ffmpeg: { bin: process.env.FFMPEG_PATH ?? 'ffmpeg', preset: 'ultrafast' },
    pollEveryMs: 1,
  });
}

const fakeHandlers = () => handlersWith({ 'veo-3.1-lite': createFakeVideo('veo-3.1-lite') });

async function startVideo(input: Record<string, unknown> = {}) {
  const workspaceId = await createTestWorkspace(db, { credits: 100, videoSeconds: 120 });
  await addTestProfile(db, workspaceId);
  const started = await startGeneration(
    {
      db,
      queues: recordingQueues(),
      log,
      registry: generators,
      compile: { rewriters: [] },
      moderation: createFakeModeration(),
    },
    {
      workspaceId,
      generatorKey: 'video',
      input: { ...intent, targetPlatform: 'instagram', ...input },
    },
  );
  if (!started.ok) throw new Error(started.reason);
  return { workspaceId, started };
}

describe('the handler map', () => {
  it('films video and leaves the storyboard alone, though both compile as video', () => {
    const keys = Object.keys(fakeHandlers()).sort();
    // The storyboard shares the output type, because it needs the profile that plans scenes.
    // Claiming its key here would have the image generator's adapter looked up as a video one.
    expect(keys).toEqual(['regenerate_scene', 'video']);
  });
});

describe('a video render', () => {
  it('plans the scenes, renders them in order, and settles the seconds delivered', async () => {
    const { workspaceId, started } = await startVideo();
    // Held for the most beats a free-flowing plan could pick for the 24s default — four,
    // one more than the three the deterministic fallback (no planner in this test) actually
    // delivers (WP59); settlement below is on what was actually delivered.
    expect(started.job.held.videoSeconds).toBe(32);

    const result = await processJob(
      { db, handlers: fakeHandlers(), log },
      { jobId: started.job.id, correlationId: 'c' },
    );
    expect(result).toBe('settled');

    const job = await findJob(db, workspaceId, started.job.id);
    expect(job).toMatchObject({
      status: 'COMPLETE',
      settled: { credits: 0, videoSeconds: 24 },
    });

    const [output] = await scoped(db, workspaceId).select(outputs);
    if (!output) throw new Error('no output');
    expect(output.kind).toBe('video');
    const scenes = await listScenes(db, workspaceId, output.id);
    expect(scenes).toHaveLength(3);
    expect(scenes.map((scene) => scene.index)).toEqual([0, 1, 2]);
    for (const scene of scenes) {
      expect(scene.clipUrl).toContain(`/scenes/${output.id}/${scene.index}-0.mp4`);
      expect(scene.durationS).toBe(8);
      expect(scene.regeneratedCount).toBe(0);
      expect(scene.prompt).toContain('Scene');
      // The clip is really in the store, under the key its URL points at.
      const key = (scene.clipUrl ?? '').split('/').slice(3).join('/');
      await expect(store.get(key)).resolves.toBeInstanceOf(Uint8Array);
    }
  }, 300_000);

  it('asks for the length the creator chose, in eight-second beats', async () => {
    const { workspaceId, started } = await startVideo({ targetDurationSeconds: 8 });
    // Held for up to two beats (one more than the single beat an 8s target implies); the
    // fallback planner (no planner in this test) still lands on exactly one.
    expect(started.job.held.videoSeconds).toBe(16);
    await processJob(
      { db, handlers: fakeHandlers(), log },
      { jobId: started.job.id, correlationId: 'c' },
    );
    const [output] = await scoped(db, workspaceId).select(outputs);
    expect(await listScenes(db, workspaceId, output?.id ?? '')).toHaveLength(1);
    expect(await findJob(db, workspaceId, started.job.id)).toMatchObject({
      settled: { videoSeconds: 8 },
    });
  }, 300_000);

  it('settles only what arrived when a scene is refused', async () => {
    const { workspaceId, started } = await startVideo();
    const result = await processJob(
      { db, handlers: handlersWith({ 'veo-3.1-lite': scripted([2]) }), log },
      { jobId: started.job.id, correlationId: 'c' },
    );
    expect(result).toBe('settled');
    // Two of three scenes arrived, so sixteen seconds are charged, not twenty four.
    expect(await findJob(db, workspaceId, started.job.id)).toMatchObject({
      settled: { videoSeconds: 16 },
    });
    const [output] = await scoped(db, workspaceId).select(outputs);
    const scenes = await listScenes(db, workspaceId, output?.id ?? '');
    expect(scenes.filter((scene) => scene.clipUrl !== null)).toHaveLength(2);
  }, 300_000);

  it('refunds in full, as blocked, when every scene is refused', async () => {
    const { workspaceId, started } = await startVideo();
    const result = await processJob(
      { db, handlers: handlersWith({ 'veo-3.1-lite': scripted([1, 2, 3]) }), log },
      { jobId: started.job.id, correlationId: 'c' },
    );
    expect(result).toBe('refunded');
    expect(await findJob(db, workspaceId, started.job.id)).toMatchObject({
      status: 'BLOCKED',
      settled: null,
    });
    // The seconds are back.
    expect((await scoped(db, workspaceId).workspace())?.videoSecondsBalance).toBe(120);
  }, 300_000);

  it('never pays twice for a redelivered render', async () => {
    const { workspaceId, started } = await startVideo({ targetDurationSeconds: 8 });
    const handlers = fakeHandlers();
    await processJob({ db, handlers, log }, { jobId: started.job.id, correlationId: 'c' });
    const [job] = await scoped(db, workspaceId).select((await import('@cgp/db')).jobs, {
      where: (t, op) => op.eq(t.id, started.job.id),
    });
    if (!job) throw new Error('no job');
    const handler = handlers.video;
    if (!handler) throw new Error('no handler');
    const again = await handler(job, log);
    expect(again.actual.videoSeconds).toBe(8);
    expect(again.telemetry.realisedCostInr).toBe(0);
    const [output] = await scoped(db, workspaceId).select(outputs);
    expect(await listScenes(db, workspaceId, output?.id ?? '')).toHaveLength(1);
  }, 300_000);

  it('refuses a clip the safety check will not pass, and charges nothing for it', async () => {
    const blocking: ModerationAdapter = {
      key: 'stub',
      checkText: () => Promise.resolve({ allowed: true, flagged: [] }),
      checkImage: () =>
        Promise.resolve({ allowed: false, flagged: [{ category: 'violence' as const, score: 1 }] }),
    };
    const { workspaceId, started } = await startVideo({ targetDurationSeconds: 8 });
    const result = await processJob(
      {
        db,
        handlers: handlersWith({ 'veo-3.1-lite': createFakeVideo('veo-3.1-lite') }, blocking),
        log,
      },
      { jobId: started.job.id, correlationId: 'c' },
    );
    expect(result).toBe('refunded');
    expect(await findJob(db, workspaceId, started.job.id)).toMatchObject({ status: 'BLOCKED' });
  }, 300_000);
});

describe('the reel', () => {
  it('is rendered from the scenes and kept as the output, when a renderer is there', async () => {
    const { workspaceId, started } = await startVideo({ targetDurationSeconds: 16 });
    // The fake video adapter returns the same fixture clip, which is a real MP4.
    const result = await processJob(
      { db, handlers: handlersWith({ 'veo-3.1-lite': scripted([]) }), log },
      { jobId: started.job.id, correlationId: 'c' },
    );
    expect(result).toBe('settled');

    const [output] = await scoped(db, workspaceId).select(outputs);
    const reel = (output?.metadata as { reel?: { url: string; durationSeconds: number } }).reel;
    if (!reel) throw new Error('no reel was rendered; is FFMPEG_PATH set?');
    expect(output?.storageKey).toContain(`${workspaceId}/reels/`);
    expect(reel.url).toContain('.mp4');
    // Two eight second scenes, joined into one file.
    expect(reel.durationSeconds).toBeGreaterThan(15);
    const stored = await store.get(output?.storageKey ?? '');
    expect(stored.byteLength).toBeGreaterThan(1000);
  }, 300_000);
});

describe('regenerating one scene', () => {
  it('replaces that clip, counts the retry, and leaves the others alone', async () => {
    const { workspaceId, started } = await startVideo();
    const handlers = fakeHandlers();
    await processJob({ db, handlers, log }, { jobId: started.job.id, correlationId: 'c' });
    const [output] = await scoped(db, workspaceId).select(outputs);
    const before = await listScenes(db, workspaceId, output?.id ?? '');
    const target = before[1];
    if (!target) throw new Error('no scene');

    const job = {
      id: started.job.id,
      workspaceId,
      input: { sceneId: target.id },
      creditsHeld: 0,
      videoSecondsHeld: 8,
    } as unknown as Parameters<(typeof handlers)[string]>[0];
    const handler = handlers[REGENERATE_SCENE];
    if (!handler) throw new Error('no handler');
    const outcome = await handler(job, log);

    expect(outcome.actual.videoSeconds).toBe(8);
    const after = await listScenes(db, workspaceId, output?.id ?? '');
    expect(after[1]?.regeneratedCount).toBe(1);
    expect(after[1]?.clipUrl).toContain(`${target.index}-1.mp4`);
    // The other scenes are untouched, clip and count.
    expect(after[0]?.clipUrl).toBe(before[0]?.clipUrl);
    expect(after[2]?.regeneratedCount).toBe(0);
  }, 300_000);

  it('can be asked for, which it could not before (WP50)', async () => {
    const { workspaceId, started } = await startVideo();
    const handlers = fakeHandlers();
    await processJob({ db, handlers, log }, { jobId: started.job.id, correlationId: 'c' });
    const [output] = await scoped(db, workspaceId).select(outputs);
    const [scene] = await listScenes(db, workspaceId, output?.id ?? '');
    if (!scene) throw new Error('no scene');

    // The handler has existed since WP22 with nothing able to submit to it: a job needs a
    // generator to price it, and there was none. Now there is, and it holds one scene.
    const asked = await startGeneration(
      {
        db,
        queues: recordingQueues(),
        log,
        registry: generators,
        compile: { rewriters: [] },
        moderation: createFakeModeration(),
      },
      {
        workspaceId,
        generatorKey: REGENERATE_SCENE,
        input: { ...intent, targetPlatform: 'instagram', sceneId: scene.id },
      },
    );
    if (!asked.ok) throw new Error(asked.reason);
    expect(asked.job.held).toEqual({ credits: 0, videoSeconds: 8 });
    expect(asked.job.jobClass).toBe('render');

    const outcome = await processJob({ db, handlers, log }, {
      jobId: asked.job.id,
      correlationId: 'c',
    } satisfies QueuedJobData);
    expect(outcome).toBe('settled');
    const after = await listScenes(db, workspaceId, output?.id ?? '');
    expect(after[0]?.regeneratedCount).toBe(1);
  }, 300_000);

  it('fails without a scene, rather than guessing which one', async () => {
    const handlers = fakeHandlers();
    const handler = handlers[REGENERATE_SCENE];
    if (!handler) throw new Error('no handler');
    const job = { id: 'x', workspaceId: 'y', input: {} } as unknown as Parameters<
      typeof handler
    >[0];
    await expect(handler(job, log)).rejects.toThrow(/no scene/i);
  }, 300_000);
});

describe('the second provider', () => {
  it('is a terminal refusal, not a silent failure', async () => {
    const { started } = await startVideo({ targetDurationSeconds: 8 });
    const stub: VideoAdapter = {
      key: 'second',
      submit: () =>
        Promise.reject(
          new AdapterError({ code: 'NOT_CONFIGURED', message: 'no account', category: 'terminal' }),
        ),
      poll: () => Promise.reject(new Error('unused')),
    };
    const result = await processJob(
      { db, handlers: handlersWith({ 'veo-3.1-lite': stub }), log },
      { jobId: started.job.id, correlationId: 'c' },
    );
    expect(result).toBe('refunded');
  }, 300_000);
});

describe('filming the frame that was approved (WP38)', () => {
  /** A video adapter that remembers whether it was given a still to animate. */
  function watchingAdapter() {
    const asks: Array<{ hasStartImage: boolean; mimeType?: string }> = [];
    const inner = createFakeVideo('veo-3.1-lite');
    const adapter: VideoAdapter = {
      key: inner.key,
      submit: (request) => {
        asks.push({
          hasStartImage: Boolean(request.startImage),
          ...(request.startImage ? { mimeType: request.startImage.mimeType } : {}),
        });
        return inner.submit(request);
      },
      poll: (id) => inner.poll(id),
    };
    return { adapter, asks };
  }

  /**
   * A real storyboard: drawn by its own handler, so the frames and their keys are whatever
   * that handler actually writes rather than whatever this test imagines it writes.
   *
   * `withKeys` false is a storyboard drawn before WP38, which has no key to fetch. `inStore`
   * false points the keys at objects that are not there, which is what a cleared bucket
   * looks like.
   */
  async function storyboardFor(
    workspaceId: string,
    frames: number,
    { withKeys = true, inStore = true }: { withKeys?: boolean; inStore?: boolean } = {},
  ) {
    const started = await startGeneration(
      {
        db,
        queues: recordingQueues(),
        log,
        registry: generators,
        compile: { rewriters: [] },
        moderation: createFakeModeration(),
      },
      {
        workspaceId,
        generatorKey: 'storyboard',
        input: { ...intent, targetPlatform: 'instagram', targetDurationSeconds: frames * 8 },
      },
    );
    if (!started.ok) throw new Error(started.reason);
    const handlers = createStoryboardHandler({
      db,
      registry: generators,
      adapters: createImageAdapters('fake'),
      planner: undefined,
      moderation: createFakeModeration(),
      store,
      costInr: () => 0,
      providerLabel: 'fake',
    });
    const drawn = await processJob(
      { db, handlers, log },
      {
        jobId: started.job.id,
        correlationId: 'c',
      },
    );
    if (drawn !== 'settled') throw new Error(`storyboard ${drawn}`);

    const [output] = await scoped(db, workspaceId).select(outputs, {
      where: (t, op) => op.eq(t.jobId, started.job.id),
      limit: 1,
    });
    if (!output) throw new Error('no storyboard output');
    if (withKeys && inStore) return output;

    const metadata = output.metadata as { storyboard: Array<Record<string, unknown>> };
    await scoped(db, workspaceId).update(
      outputs,
      {
        metadata: {
          ...metadata,
          storyboard: metadata.storyboard.map((frame) => {
            if (!withKeys) {
              return Object.fromEntries(Object.entries(frame).filter(([name]) => name !== 'key'));
            }
            return { ...frame, key: `${String(frame.key)}.gone` };
          }),
        },
      },
      (t, op) => op.eq(t.id, output.id),
    );
    return output;
  }

  /** A reel committed from a storyboard, filmed by an adapter we can watch. */
  async function film(frames: number, options?: { withKeys?: boolean; inStore?: boolean }) {
    const workspaceId = await createTestWorkspace(db, { credits: 200, videoSeconds: 120 });
    await addTestProfile(db, workspaceId);
    const storyboard = await storyboardFor(workspaceId, frames, options);
    const started = await startGeneration(
      {
        db,
        queues: recordingQueues(),
        log,
        registry: generators,
        compile: { rewriters: [] },
        moderation: createFakeModeration(),
      },
      {
        workspaceId,
        generatorKey: 'video',
        input: {
          ...intent,
          targetPlatform: 'instagram',
          // A reel committed from a storyboard films exactly its approved scenes regardless
          // (WP59), so this is unused on that path — kept for a direct-to-video fallback.
          targetDurationSeconds: frames * 8,
          storyboardOutputId: storyboard.id,
        },
      },
    );
    if (!started.ok) throw new Error(started.reason);
    const { adapter, asks } = watchingAdapter();
    const result = await processJob(
      { db, handlers: handlersWith({ 'veo-3.1-lite': adapter }), log },
      { jobId: started.job.id, correlationId: 'c' },
    );
    return { asks, result };
  }

  it('animates the approved still instead of imagining the scene again', async () => {
    const { asks } = await film(2);

    expect(asks).toHaveLength(2);
    expect(asks.every((ask) => ask.hasStartImage)).toBe(true);
    // Sent as the type it was stored as, not as whatever the caller assumed.
    expect(asks[0]?.mimeType).toMatch(/^image\/(png|jpeg)$/);
    // Two scenes, each drawn then filmed: slower than the suite's default patience.
  }, 60_000);

  it('films from the words when a storyboard was drawn before this existed', async () => {
    // No key on the frame, so there is nothing to fetch and nothing to animate.
    const { asks } = await film(1, { withKeys: false });

    expect(asks).toHaveLength(1);
    expect(asks[0]?.hasStartImage).toBe(false);
  }, 60_000);

  it('films from the words when the still has gone, rather than failing the reel', async () => {
    // The key is on the frame but the object is not in the store, which is what a cleared
    // bucket looks like. A missing picture costs the animation, not the reel.
    const { asks, result } = await film(1, { inStore: false });

    expect(asks[0]?.hasStartImage).toBe(false);
    expect(result).toBe('settled');
  }, 60_000);
});

describe('model and reference images (WP63)', () => {
  /** A video adapter that remembers what references it was given. */
  function watchingVideoAdapter(key: string) {
    const seen: Array<{ references: number }> = [];
    const inner = createFakeVideo(key);
    const adapter: VideoAdapter = {
      key: inner.key,
      submit: (request) => {
        seen.push({ references: request.references?.length ?? 0 });
        return inner.submit(request);
      },
      poll: (id) => inner.poll(id),
    };
    return { adapter, seen };
  }

  it('uses the model the request asked for', async () => {
    const omni = createFakeVideo('gemini-omni-1.1-flash');
    const { workspaceId, started } = await startVideo({ videoModel: 'gemini-omni-1.1-flash' });
    await processJob(
      {
        db,
        handlers: handlersWith({
          'veo-3.1-lite': createFakeVideo('veo-3.1-lite'),
          'gemini-omni-1.1-flash': omni,
        }),
        log,
      },
      { jobId: started.job.id, correlationId: 'c' },
    );
    const [output] = await scoped(db, workspaceId).select(outputs);
    expect((output?.metadata as { adapter?: string })?.adapter).toBe('gemini-omni-1.1-flash');
  }, 300_000);

  it('sends uploaded references to a model whose capability accepts them', async () => {
    const { adapter, seen } = watchingVideoAdapter('gemini-omni-1.1-flash');
    const workspaceId0 = await createTestWorkspace(db, { credits: 100, videoSeconds: 120 });
    await addTestProfile(db, workspaceId0);
    const key = `${workspaceId0}/references/test.png`;
    await store.put(key, new Uint8Array([1, 2, 3]), 'image/png');
    const started = await startGeneration(
      { db, queues: recordingQueues(), log, registry: generators, compile: { rewriters: [] }, moderation: createFakeModeration() },
      {
        workspaceId: workspaceId0,
        generatorKey: 'video',
        input: {
          ...intent,
          targetPlatform: 'instagram',
          videoModel: 'gemini-omni-1.1-flash',
          referenceImageKeys: [key],
        },
      },
    );
    if (!started.ok) throw new Error(started.reason);
    await processJob(
      {
        db,
        handlers: handlersWith(
          { 'veo-3.1-lite': createFakeVideo('veo-3.1-lite'), 'gemini-omni-1.1-flash': adapter },
          undefined,
          (): VideoCapability => ({
            aspectRatios: ['9:16', '16:9'],
            resolutions: ['720p', '1080p'],
            durationSeconds: { min: 8, max: 8, step: 8 },
            acceptsStartImage: false,
            acceptsReferenceImages: true,
            maxReferenceImages: 3,
            generatesAudio: true,
            requestsPerMinute: 1,
          }),
        ),
        log,
      },
      { jobId: started.job.id, correlationId: 'c' },
    );
    expect(seen.every((s) => s.references === 1)).toBe(true);
    expect(seen.length).toBeGreaterThan(0);
  }, 300_000);

  it('never sends references to Veo, which has no capability for them', async () => {
    const { adapter, seen } = watchingVideoAdapter('veo-3.1-lite');
    const workspaceId0 = await createTestWorkspace(db, { credits: 100, videoSeconds: 120 });
    await addTestProfile(db, workspaceId0);
    const key = `${workspaceId0}/references/test.png`;
    await store.put(key, new Uint8Array([1, 2, 3]), 'image/png');
    const started = await startGeneration(
      { db, queues: recordingQueues(), log, registry: generators, compile: { rewriters: [] }, moderation: createFakeModeration() },
      {
        workspaceId: workspaceId0,
        generatorKey: 'video',
        input: { ...intent, targetPlatform: 'instagram', referenceImageKeys: [key] },
      },
    );
    if (!started.ok) throw new Error(started.reason);
    await processJob(
      {
        db,
        handlers: handlersWith(
          { 'veo-3.1-lite': adapter },
          undefined,
          (): VideoCapability => ({
            aspectRatios: ['9:16', '16:9'],
            resolutions: ['720p', '1080p'],
            durationSeconds: { min: 8, max: 8, step: 8 },
            acceptsStartImage: true,
            acceptsReferenceImages: false,
            maxReferenceImages: 0,
            generatesAudio: false,
            requestsPerMinute: 1,
          }),
        ),
        log,
      },
      { jobId: started.job.id, correlationId: 'c' },
    );
    expect(seen.every((s) => s.references === 0)).toBe(true);
    expect(seen.length).toBeGreaterThan(0);
  }, 300_000);

  it('ignores videoModel and stays on Veo when committing from a storyboard', async () => {
    const workspaceId0 = await createTestWorkspace(db, { credits: 200, videoSeconds: 120 });
    await addTestProfile(db, workspaceId0);
    const storyboardStarted = await startGeneration(
      { db, queues: recordingQueues(), log, registry: generators, compile: { rewriters: [] }, moderation: createFakeModeration() },
      {
        workspaceId: workspaceId0,
        generatorKey: 'storyboard',
        input: { ...intent, targetPlatform: 'instagram', targetDurationSeconds: 8 },
      },
    );
    if (!storyboardStarted.ok) throw new Error(storyboardStarted.reason);
    const storyboardHandlers = createStoryboardHandler({
      db,
      registry: generators,
      adapters: createImageAdapters('fake'),
      planner: undefined,
      moderation: createFakeModeration(),
      store,
      costInr: () => 0,
      providerLabel: 'fake',
    });
    const drawn = await processJob(
      { db, handlers: storyboardHandlers, log },
      { jobId: storyboardStarted.job.id, correlationId: 'c' },
    );
    if (drawn !== 'settled') throw new Error(`storyboard ${drawn}`);
    const [storyboardOutput] = await scoped(db, workspaceId0).select(outputs, {
      where: (t, op) => op.eq(t.jobId, storyboardStarted.job.id),
      limit: 1,
    });
    if (!storyboardOutput) throw new Error('no storyboard output');

    const { adapter: veoAdapter, seen } = watchingVideoAdapter('veo-3.1-lite');
    const omni = createFakeVideo('gemini-omni-1.1-flash');
    const started = await startGeneration(
      { db, queues: recordingQueues(), log, registry: generators, compile: { rewriters: [] }, moderation: createFakeModeration() },
      {
        workspaceId: workspaceId0,
        generatorKey: 'video',
        input: {
          ...intent,
          targetPlatform: 'instagram',
          videoModel: 'gemini-omni-1.1-flash',
          storyboardOutputId: storyboardOutput.id,
        },
      },
    );
    if (!started.ok) throw new Error(started.reason);
    await processJob(
      {
        db,
        handlers: handlersWith({ 'veo-3.1-lite': veoAdapter, 'gemini-omni-1.1-flash': omni }),
        log,
      },
      { jobId: started.job.id, correlationId: 'c' },
    );
    expect(seen.length).toBeGreaterThan(0);
  }, 300_000);
});
