import type {
  CompilerProfileConfig,
  GeneratedClip,
  ModerationAdapter,
  ObjectStore,
  TextAdapter,
  VideoAdapter,
  VideoRequest,
} from '@cgp/contracts';
import {
  catalog,
  compilerProfiles,
  createScenes,
  findScene,
  listScenes,
  outputs,
  replaceSceneClip,
  scoped,
  setSceneClip,
  type Database,
  type VideoSceneRow,
} from '@cgp/db';
import { findCompiledPrompt, planScenes } from '@cgp/orchestration';
import { SECONDS_PER_SCENE } from '../generators/definitions';
import { buildReel, type ReelResolution, type ReelScene } from '../render/reel';
import { ffmpegAvailable, type FfmpegOptions } from '../render/ffmpeg';
import { sampleFrames } from '../render/frames';
import type { GeneratorRegistry } from '../generators/registry';
import { postCheckOutput } from '../moderation';
import { JobBlocked, type JobHandler } from '../process';

// The video render (WP22): a compiled prompt becomes up to three scenes, each an eight second
// clip from the video provider, stored and recorded in order. Held on the seconds asked for
// and settled on the seconds delivered (plan section 7), so a scene the provider refused is
// never charged for.
//
// Scenes run one after another, not together: the provider meters by the minute, and a burst
// loses the whole reel rather than one shot. A render is minutes long by nature.

/** The generator key for regenerating one scene of an existing video. */
export const REGENERATE_SCENE = 'regenerate_scene';

/** How often the provider is asked whether a clip is ready, and for how long. */
const POLL_EVERY_MS = 10_000;
const POLL_LIMIT_MS = 10 * 60_000;

/** Invariant 12: the model never renders text; captions are composited in the render. */
const NEGATIVE_PROMPT = 'text, captions, letters, watermark, logo, subtitles';

export interface VideoHandlerDeps {
  db: Database;
  registry: GeneratorRegistry;
  /** By model key, as generators name them in `providerAdapter`. */
  adapters: Readonly<Record<string, VideoAdapter>>;
  /** Plans the scenes. The engine's provider, not the generator's (invariant 4). */
  planner: TextAdapter | undefined;
  moderation: ModerationAdapter;
  store: ObjectStore;
  costInr: (adapterKey: string, resolution: VideoRequest['resolution'], seconds: number) => number;
  providerLabel: string;
  /** The renderer, which joins the scenes into one reel (plan section 4.6). */
  ffmpeg: FfmpegOptions;
  /** A licensed bed for the reel, chosen by the caller from the catalogue (FR-VD-08). */
  music?: () => Promise<{ data: Uint8Array } | undefined>;
  /** The workspace's logo, cornered on the reel. */
  logo?: (workspaceId: string) => Promise<{ data: Uint8Array; mimeType: string } | undefined>;
  /** Only tests shorten these. */
  pollEveryMs?: number;
}

interface VideoJobInput {
  compiledPromptId?: unknown;
  sceneCount?: unknown;
  /** Set on a regenerate job: the one scene to draw again. */
  sceneId?: unknown;
}

/** One tier for both the provider and the render, so they cannot drift apart. */
const RESOLUTION = '720p' as const satisfies ReelResolution;

/** Submits one scene and waits for it, or gives the reason it will never arrive. */
async function renderScene(
  deps: VideoHandlerDeps,
  adapter: VideoAdapter,
  prompt: string,
  log: Parameters<JobHandler>[1],
): Promise<{ ok: true; clip: GeneratedClip } | { ok: false; code: string; blocked: boolean }> {
  const { operationId } = await adapter.submit({
    prompt,
    negativePrompt: NEGATIVE_PROMPT,
    aspectRatio: '9:16',
    durationSeconds: SECONDS_PER_SCENE,
    resolution: RESOLUTION,
  });

  const every = deps.pollEveryMs ?? POLL_EVERY_MS;
  const until = Date.now() + POLL_LIMIT_MS;
  for (;;) {
    await new Promise((resolve) => setTimeout(resolve, every));
    const result = await adapter.poll(operationId);
    if (result.status === 'done') return { ok: true, clip: result.clip };
    if (result.status === 'failed') {
      log.warn({ code: result.error.code }, 'scene refused');
      return {
        ok: false,
        code: result.error.code,
        blocked: result.error.code === 'SAFETY_FILTERED',
      };
    }
    if (Date.now() > until) return { ok: false, code: 'TIMED_OUT', blocked: false };
  }
}

/**
 * A clip's object. The attempt is part of the key, so generating a scene again writes a new
 * object rather than overwriting the one the creator is still looking at.
 */
async function storeClip(
  deps: VideoHandlerDeps,
  workspaceId: string,
  scene: VideoSceneRow,
  clip: GeneratedClip,
  attempt: number,
): Promise<string> {
  const key = `${workspaceId}/scenes/${scene.outputId}/${scene.index}-${attempt}.mp4`;
  const stored = await deps.store.put(key, clip.data, clip.mimeType);
  return stored.url;
}

async function sceneConfig(db: Database, key: string, version: number) {
  const [profile] = await catalog(db).select(compilerProfiles, {
    where: (t, op) => op.and(op.eq(t.key, key), op.eq(t.version, version)),
    limit: 1,
  });
  return profile?.config as CompilerProfileConfig | undefined;
}

/**
 * The video generator's handler. One job, one reel: plan the scenes, render them in order,
 * keep what arrives, and settle on the seconds delivered.
 */
export function createVideoHandlers(deps: VideoHandlerDeps): Record<string, JobHandler> {
  const handlers: Record<string, JobHandler> = {};

  for (const generator of deps.registry.list()) {
    if (generator.outputType !== 'video') continue;

    handlers[generator.key] = async (job, log) => {
      const ws = scoped(deps.db, job.workspaceId);
      const adapter = deps.adapters[generator.providerAdapter];
      if (!adapter) throw new Error(`No video adapter ${generator.providerAdapter}`);

      const input = job.input as VideoJobInput;
      if (typeof input.compiledPromptId !== 'string') throw new Error('Job has no compiled prompt');
      const prompt = await findCompiledPrompt(deps.db, job.workspaceId, input.compiledPromptId);
      if (!prompt) throw new Error('Compiled prompt not found');

      // A redelivered job keeps the reel it already made rather than paying for another.
      const [existing] = await ws.select(outputs, { where: (t, op) => op.eq(t.jobId, job.id) });
      if (existing) {
        const scenes = await listScenes(deps.db, job.workspaceId, existing.id);
        const seconds = scenes.reduce((total, scene) => total + (scene.durationS ?? 0), 0);
        log.info({ jobId: job.id }, 'video already rendered, settling without a provider call');
        return {
          actual: { credits: 0, videoSeconds: Math.round(seconds) },
          telemetry: {
            actionClass: generator.key,
            provider: deps.providerLabel,
            realisedCostInr: 0,
          },
        };
      }

      const sceneCount =
        typeof input.sceneCount === 'number' && input.sceneCount > 0 ? input.sceneCount : 3;
      const config = await sceneConfig(
        deps.db,
        prompt.compilerProfileKey,
        prompt.compilerProfileVersion,
      );
      if (!config) throw new Error(`${prompt.compilerProfileKey} is missing`);

      const plan = await planScenes({
        prompt: prompt.text,
        config,
        sceneCount,
        provider: deps.planner,
        log,
      });
      log.info({ jobId: job.id, sceneCount, fallbackUsed: plan.fallbackUsed }, 'scenes planned');

      // The output row exists before the first clip, so a render that dies halfway leaves the
      // scenes it planned and the clips it finished.
      const [output] = await ws.insert(outputs, {
        jobId: job.id,
        kind: 'video',
        storageKey: `${job.workspaceId}/scenes/${job.id}`,
        metadata: {
          sceneCount,
          resolution: RESOLUTION,
          scenePlanFallback: plan.fallbackUsed,
          adapter: adapter.key,
        },
        compiledPromptId: prompt.id,
        templateId: prompt.templateId,
        brandKitVersion: prompt.brandKitVersion,
      });
      if (!output) throw new Error('Output insert returned no row');
      const scenes = await createScenes(deps.db, job.workspaceId, output.id, plan.scenes);

      let delivered = 0;
      let blocked = false;
      const rendered: ReelScene[] = [];
      for (const scene of scenes) {
        const result = await renderScene(deps, adapter, scene.prompt, log);
        if (!result.ok) {
          blocked ||= result.blocked;
          continue;
        }
        // An image checker takes images, so a clip is checked on frames sampled out of it
        // (plan section 6). Without a renderer there is no way to sample, and an unchecked
        // clip is never released.
        const checked = await postCheckOutput(
          { db: deps.db, moderation: deps.moderation, log },
          job,
          { media: await sampleFrames(deps.ffmpeg, result.clip.data, result.clip.durationSeconds) },
        );
        if (checked) {
          blocked = true;
          continue;
        }
        const clipUrl = await storeClip(deps, job.workspaceId, scene, result.clip, 0);
        await setSceneClip(deps.db, job.workspaceId, scene.id, {
          clipUrl,
          durationS: result.clip.durationSeconds,
        });
        delivered += result.clip.durationSeconds;
        rendered.push({ data: result.clip.data, durationSeconds: result.clip.durationSeconds });
      }

      // Nothing usable came back: refunded in full, and blocked when that is why.
      if (delivered === 0) {
        if (blocked) throw new JobBlocked('other');
        throw new Error('No scene could be rendered');
      }

      // The reel itself: scenes joined, bed under them, logo cornered (plan section 4.6).
      // A render that cannot run leaves the scenes, which are still worth what was paid.
      const reel = await renderReel(deps, job.workspaceId, rendered, log);
      if (reel) {
        await ws.update(
          outputs,
          { storageKey: reel.key, metadata: { ...(output.metadata as object), reel: reel.view } },
          (t, op) => op.eq(t.id, output.id),
        );
      }

      const seconds = Math.round(delivered);
      return {
        actual: { credits: 0, videoSeconds: seconds },
        telemetry: {
          actionClass: generator.key,
          provider: `${deps.providerLabel}:${adapter.key}`,
          realisedCostInr: deps.costInr(adapter.key, RESOLUTION, seconds),
        },
      };
    };
  }

  /**
   * One scene, drawn again in place (WP22). Its own job, because it holds and settles its own
   * seconds: a regenerate costs what a scene costs, and says so before it runs.
   */
  handlers[REGENERATE_SCENE] = async (job, log) => {
    const input = job.input as VideoJobInput;
    if (typeof input.sceneId !== 'string') throw new Error('Job has no scene');
    const scene = await findScene(deps.db, job.workspaceId, input.sceneId);
    if (!scene) throw new Error('Scene not found');

    const generator = deps.registry.list().find((entry) => entry.outputType === 'video');
    const adapter = generator ? deps.adapters[generator.providerAdapter] : undefined;
    if (!adapter) throw new Error('No video adapter');

    const result = await renderScene(deps, adapter, scene.prompt, log);
    if (!result.ok) {
      if (result.blocked) throw new JobBlocked('other');
      throw new Error(`Scene could not be rendered (${result.code})`);
    }
    const checked = await postCheckOutput({ db: deps.db, moderation: deps.moderation, log }, job, {
      media: [{ data: result.clip.data, mimeType: result.clip.mimeType }],
    });
    if (checked) throw new JobBlocked(checked);

    // The next attempt, which is where the count is about to go.
    const clipUrl = await storeClip(
      deps,
      job.workspaceId,
      scene,
      result.clip,
      scene.regeneratedCount + 1,
    );
    await replaceSceneClip(deps.db, job.workspaceId, scene.id, {
      clipUrl,
      durationS: result.clip.durationSeconds,
    });

    const seconds = Math.round(result.clip.durationSeconds);
    return {
      actual: { credits: 0, videoSeconds: seconds },
      telemetry: {
        actionClass: REGENERATE_SCENE,
        provider: `${deps.providerLabel}:${adapter.key}`,
        realisedCostInr: deps.costInr(adapter.key, RESOLUTION, seconds),
      },
    };
  };

  return handlers;
}

/**
 * Joins what was rendered into one file. Returns nothing when there is no renderer on this
 * machine or the render fails: the clips are already paid for and stored, and a reel that
 * cannot be built is a missing convenience rather than a lost job.
 */
async function renderReel(
  deps: VideoHandlerDeps,
  workspaceId: string,
  scenes: ReelScene[],
  log: Parameters<JobHandler>[1],
): Promise<{ key: string; view: Record<string, unknown> } | undefined> {
  if (scenes.length === 0) return undefined;
  if (!(await ffmpegAvailable(deps.ffmpeg))) {
    log.warn({ bin: deps.ffmpeg.bin }, 'no renderer on this machine; scenes kept, reel not built');
    return undefined;
  }
  try {
    const reel = await buildReel(deps.ffmpeg, {
      scenes,
      resolution: RESOLUTION,
      music: await deps.music?.(),
      logo: await deps.logo?.(workspaceId),
    });
    const key = `${workspaceId}/reels/${crypto.randomUUID()}.mp4`;
    const stored = await deps.store.put(key, reel.data, reel.mimeType);
    log.info({ seconds: reel.durationSeconds, bytes: reel.data.byteLength }, 'reel rendered');
    return {
      key: stored.key,
      view: {
        url: stored.url,
        width: reel.width,
        height: reel.height,
        durationSeconds: reel.durationSeconds,
      },
    };
  } catch (err) {
    log.warn({ err }, 'reel could not be rendered; scenes kept');
    return undefined;
  }
}

/** The seconds a reel of this many scenes asks for, which is what the hold is taken on. */
export function videoSecondsFor(sceneCount: number): number {
  return sceneCount * SECONDS_PER_SCENE;
}
