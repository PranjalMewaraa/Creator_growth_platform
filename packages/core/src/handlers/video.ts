import type {
  CompilerProfileConfig,
  GeneratedClip,
  MediaBytes,
  ModerationAdapter,
  ObjectStore,
  TextAdapter,
  VideoAdapter,
  JobStage,
  VideoCapability,
  VideoRequest,
  VoiceAdapter,
} from '@cgp/contracts';
type VideoAspectRatio = VideoRequest['aspectRatio'];
import { checkVideo } from '@cgp/contracts';
import {
  catalog,
  compilerProfiles,
  templateVersions,
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
import { findCompiledPrompt, planScenes, planVoiceover } from '@cgp/orchestration';
import { SECONDS_PER_SCENE } from '../generators/definitions';
import { buildReel, REEL_FRAMES, type ReelResolution, type ReelScene } from '../render/reel';
import {
  buildAss,
  captionsFromVoiceover,
  DEFAULT_CAPTION_STYLE,
  type CaptionStyle,
} from '../render/captions';
import { ffmpegAvailable, type FfmpegOptions } from '../render/ffmpeg';
import { sampleFrames } from '../render/frames';
import type { GeneratorRegistry } from '../generators/registry';
import { postCheckOutput } from '../moderation';
import { storyboardFrames, storyboardScenes } from './storyboard';
import { STORYBOARD_ASSEMBLE } from './storyboard-assemble';
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
  /** What the chosen model will film, so an impossible clip is refused before it is paid for. */
  capabilityOf?: (adapterKey: string) => VideoCapability | undefined;
  /** Says what is happening, as it happens (WP44). Best effort, like the deltas. */
  publishStage?: (jobId: string, stage: JobStage) => Promise<void>;
  providerLabel: string;
  /** The renderer, which joins the scenes into one reel (plan section 4.6). */
  ffmpeg: FfmpegOptions;
  /** The voice that speaks over the reel. Absent means a silent reel, which still renders. */
  voice?: VoiceAdapter;
  /** Realised cost of a voiceover, by the characters sent. */
  voiceCostInr?: (adapterKey: string, characters: number) => number;
  /** A licensed bed for the reel, chosen by the caller from the catalogue (FR-VD-08). */
  music?: () => Promise<{ data: Uint8Array } | undefined>;
  /** The workspace's logo, cornered on the reel. */
  logo?: (workspaceId: string) => Promise<{ data: Uint8Array; mimeType: string } | undefined>;
  /** Only tests shorten these. */
  pollEveryMs?: number;
}

interface VideoJobInput {
  compiledPromptId?: unknown;
  targetDurationSeconds?: unknown;
  /** Set on a regenerate job: the one scene to draw again. */
  sceneId?: unknown;
  /** Set when this reel was committed from a storyboard, whose scenes it films. */
  storyboardOutputId?: unknown;
  /** Off for a reel that should stay silent or carry only the scenes' own sound, not a spoken
   *  narration over it — not every video is explaining something (WP58). Defaults to on. */
  voiceover?: unknown;
  /** Which model films it (WP63). Falls back to the generator's own default when absent, not
   *  a model this build knows, or when committing from a storyboard. */
  videoModel?: unknown;
  /** Pictures the model should stay consistent with (WP63), by their store keys — only the
   *  models whose capability says `acceptsReferenceImages` read any. */
  referenceImageKeys?: unknown;
  /** Vertical by default; landscape when asked for (WP66). Ignored, like videoModel, when
   *  committing from a storyboard — those frames were drawn at whatever aspect the storyboard
   *  tool offers, not this one. */
  aspectRatio?: unknown;
}

type Spoken = Awaited<ReturnType<typeof speak>>;

/** The pricing/quality tier, for both the provider and the cost calc — independent of aspect
 *  ratio, which only changes the frame shape, not what the model is paid for (plan section 6). */
const RESOLUTION_TIER = '720p' as const satisfies VideoRequest['resolution'];

/**
 * The approved still, if it can still be read. A missing frame is not a reason to fail the
 * reel: the scene is filmed from its words instead, which is what every reel did before this.
 */
async function readFrame(
  deps: VideoHandlerDeps,
  key: string,
  log: Parameters<JobHandler>[1],
): Promise<MediaBytes | undefined> {
  try {
    const data = await deps.store.get(key);
    return { data, mimeType: key.endsWith('.png') ? 'image/png' : 'image/jpeg' };
  } catch (err) {
    log.warn({ err, key }, 'approved frame could not be read; filming from the words instead');
    return undefined;
  }
}

/** Submits one scene and waits for it, or gives the reason it will never arrive. */
async function renderScene(
  deps: VideoHandlerDeps,
  adapter: VideoAdapter,
  prompt: string,
  log: Parameters<JobHandler>[1],
  aspectRatio: VideoAspectRatio,
  startImage?: MediaBytes,
  references?: MediaBytes[],
): Promise<{ ok: true; clip: GeneratedClip } | { ok: false; code: string; blocked: boolean }> {
  const ask = {
    aspectRatio,
    durationSeconds: SECONDS_PER_SCENE,
    resolution: RESOLUTION_TIER,
  };
  // Only a model that says it takes one is given one (WP36, WP38).
  const animate = startImage && deps.capabilityOf?.(adapter.key)?.acceptsStartImage !== false;
  // Asked of the model before it is asked of the provider (WP36). A clip the model cannot
  // film is refused here, where it costs nothing, rather than after the seconds are held.
  const capability = deps.capabilityOf?.(adapter.key);
  const issues = capability
    ? checkVideo(capability, {
        ...ask,
        startImage: Boolean(startImage),
        references: references?.length,
      })
    : [];
  if (issues.length > 0) {
    const [first] = issues;
    log.error({ adapter: adapter.key, issues }, 'the model cannot film this');
    return { ok: false, code: first?.message ?? 'UNSUPPORTED', blocked: false };
  }

  log.info(
    { adapter: adapter.key, animating: Boolean(animate && startImage) },
    animate && startImage ? 'filming the approved frame' : 'filming from the words',
  );
  const { operationId } = await adapter.submit({
    prompt,
    negativePrompt: NEGATIVE_PROMPT,
    ...ask,
    ...(animate && startImage ? { startImage } : {}),
    ...(references?.length ? { references } : {}),
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
    // Output type is not enough: the storyboard compiles as a video too, because that is the
    // profile that plans scenes. The render class is what separates filming from previewing.
    if (generator.outputType !== 'video' || generator.jobClass !== 'render') continue;
    // Also video/render, but it stitches already-filmed clips rather than filming anything —
    // its own handler lives in handlers/storyboard-assemble.ts (WP68).
    if (generator.key === STORYBOARD_ASSEMBLE) continue;

    handlers[generator.key] = async (job, log) => {
      const ws = scoped(deps.db, job.workspaceId);
      const input = job.input as VideoJobInput;

      // The model is a choice now (WP63), except when committing from a storyboard: those
      // frames are stills for Veo's startImage to animate, not a style reference, so that path
      // is pinned to the generator's own default regardless of what videoModel asked for.
      const requestedModel =
        typeof input.videoModel === 'string' && typeof input.storyboardOutputId !== 'string'
          ? input.videoModel
          : undefined;
      const adapter =
        (requestedModel ? deps.adapters[requestedModel] : undefined) ??
        deps.adapters[generator.providerAdapter];
      if (!adapter) throw new Error(`No video adapter ${generator.providerAdapter}`);

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
          actual: { credits: 0, videoSeconds: Math.min(Math.round(seconds), job.videoSecondsHeld) },
          telemetry: {
            actionClass: generator.key,
            provider: deps.providerLabel,
            realisedCostInr: 0,
          },
        };
      }

      const targetDurationSeconds =
        typeof input.targetDurationSeconds === 'number' && input.targetDurationSeconds > 0
          ? input.targetDurationSeconds
          : 24;
      const wantsVoiceover = input.voiceover !== false;
      // Vertical by default, same as videoModel's reasoning above: a storyboard commit is
      // pinned regardless of what was asked, since those frames were drawn for a vertical
      // reel (WP66).
      const aspectRatio: VideoAspectRatio =
        input.aspectRatio === '16:9' && typeof input.storyboardOutputId !== 'string'
          ? '16:9'
          : '9:16';
      const reelFrame: ReelResolution = aspectRatio === '16:9' ? '720p-16:9' : RESOLUTION_TIER;

      // Only a model that says it reads them is given any (WP63, same reasoning as the image
      // handler's). The same pictures are offered to every scene's render call, the same way
      // `look` stays the same across every scene already.
      const videoCapability = deps.capabilityOf?.(adapter.key);
      const referenceKeys = Array.isArray(input.referenceImageKeys)
        ? input.referenceImageKeys
            .filter((k): k is string => typeof k === 'string')
            .slice(0, videoCapability?.maxReferenceImages ?? 0)
        : [];
      let references: MediaBytes[] | undefined;
      if (videoCapability?.acceptsReferenceImages && referenceKeys.length > 0) {
        const fetched = await Promise.all(
          referenceKeys.map(async (key) => {
            try {
              const data = await deps.store.get(key);
              return { data, mimeType: key.endsWith('.png') ? 'image/png' : 'image/jpeg' };
            } catch (err) {
              log.warn({ err, key }, 'reference image could not be read');
              return undefined;
            }
          }),
        );
        const usable = fetched.filter((f): f is MediaBytes => f !== undefined);
        if (usable.length > 0) references = usable;
      }

      const config = await sceneConfig(
        deps.db,
        prompt.compilerProfileKey,
        prompt.compilerProfileVersion,
      );
      if (!config) throw new Error(`${prompt.compilerProfileKey} is missing`);

      const say = (stage: JobStage) =>
        void deps.publishStage?.(job.id, stage).catch(() => undefined);
      const since = (from: number) => Math.round((Date.now() - from) / 100) / 10;
      const planningFrom = Date.now();
      say({ key: 'plan', label: 'Planning the scenes', status: 'working' });

      // A reel committed from a storyboard films the scenes that were approved, rather than
      // planning again and arriving somewhere close but different (WP26).
      const approved =
        typeof input.storyboardOutputId === 'string'
          ? await storyboardScenes(deps.db, job.workspaceId, input.storyboardOutputId)
          : undefined;
      // The stills themselves, so the reel animates the pictures the creator looked at and
      // approved rather than imagining each scene again from the same words (WP38).
      const frames =
        typeof input.storyboardOutputId === 'string'
          ? await storyboardFrames(deps.db, job.workspaceId, input.storyboardOutputId)
          : [];
      // A committed storyboard is the plan, already approved at whatever beat count it was
      // drawn at (WP59) — it is filmed as-is, not re-truncated against a duration asked for
      // only now, which could differ from the one the storyboard was drawn to.
      const plan = approved
        ? { scenes: approved, fallbackUsed: false }
        : await planScenes({
            prompt: prompt.text,
            config,
            targetDurationSeconds,
            flexible: true,
            provider: deps.planner,
            log,
          });
      log.info(
        {
          jobId: job.id,
          sceneCount: plan.scenes.length,
          targetDurationSeconds,
          fromStoryboard: Boolean(approved),
          fallbackUsed: plan.fallbackUsed,
        },
        'scenes planned',
      );
      say({
        key: 'plan',
        label: approved ? 'Using the scenes you approved' : 'Planned the scenes',
        status: 'done',
        seconds: since(planningFrom),
      });
      // One a minute is the Veo quota (WP41), so the wait is named rather than left to feel
      // like a stall.
      const perMinute = deps.capabilityOf?.(adapter.key)?.requestsPerMinute;

      // The output row exists before the first clip, so a render that dies halfway leaves the
      // scenes it planned and the clips it finished.
      const [output] = await ws.insert(outputs, {
        jobId: job.id,
        kind: 'video',
        storageKey: `${job.workspaceId}/scenes/${job.id}`,
        metadata: {
          sceneCount: plan.scenes.length,
          targetDurationSeconds,
          resolution: RESOLUTION_TIER,
          aspectRatio,
          scenePlanFallback: plan.fallbackUsed,
          adapter: adapter.key,
        },
        compiledPromptId: prompt.id,
        templateId: prompt.templateId,
        brandKitVersion: prompt.brandKitVersion,
      });
      if (!output) throw new Error('Output insert returned no row');
      const scenes = await createScenes(deps.db, job.workspaceId, output.id, plan.scenes);

      // The voice is written and spoken while the first clip is being filmed, not after the
      // last one lands: it depends on the scenes that were planned, not on the footage, and
      // Veo's one-a-minute quota leaves minutes of waiting to fill (WP41). If a scene fails
      // after all, the voiceover is redone for the scenes that did arrive — a second TTS call
      // costs under a rupee, where the wait costs everyone's attention.
      // Off entirely (WP58) when the reel is not meant to be narrated: no TTS call is made, so
      // turning it off also costs nothing extra, not just sounding different.
      const speaking: Promise<Spoken> = wantsVoiceover
        ? speak(deps, config, prompt.text, plan.scenes, plan.scenes.length, log)
        : Promise.resolve(undefined);

      let delivered = 0;
      let blocked = false;
      const rendered: ReelScene[] = [];
      for (const [index, scene] of scenes.entries()) {
        // The approved still for this scene, when there is one. A storyboard drawn before
        // WP38 has no key to fetch, and those reels film from the words as they always did.
        const frame = frames.find((f) => f.index === index);
        const startImage = frame ? await readFrame(deps, frame.key, log) : undefined;
        const filmingFrom = Date.now();
        say({
          key: `scene-${index}`,
          label: startImage ? 'Filming the frame you approved' : 'Filming the scene',
          status: 'working',
          index: index + 1,
          total: scenes.length,
          ...(perMinute && index + 1 > perMinute
            ? { note: `the video model films ${perMinute} a minute, so this one waits its turn` }
            : {}),
        });
        const result = await renderScene(
          deps,
          adapter,
          scene.prompt,
          log,
          aspectRatio,
          startImage,
          references,
        );
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
        say({
          key: `scene-${index}`,
          label: 'Filmed the scene',
          status: 'done',
          index: index + 1,
          total: scenes.length,
          seconds: since(filmingFrom),
        });
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

      // What is said over it, written by the engine from the same prompt and the scenes it
      // planned (invariant 4), then spoken. A reel with no voice still renders. Skipped
      // entirely, not just discarded, when the creator asked for no narration (WP58).
      let spoken: Spoken;
      if (!wantsVoiceover) {
        spoken = undefined;
      } else {
        say({ key: 'voice', label: 'Speaking the voiceover', status: 'working' });
        const voiceFrom = Date.now();
        const optimistic = await speaking;
        say({
          key: 'voice',
          label: optimistic ? 'Spoke the voiceover' : 'No voiceover; the reel stays silent',
          status: 'done',
          seconds: since(voiceFrom),
        });
        spoken =
          rendered.length === plan.scenes.length
            ? optimistic
            : await speak(deps, config, prompt.text, plan.scenes, rendered.length, log);
        if (optimistic && spoken !== optimistic) {
          log.info(
            { planned: plan.scenes.length, delivered: rendered.length },
            'fewer scenes arrived than were planned; the voiceover was written again for them',
          );
        }
      }

      // Captions come from what the voice said and when it said it (invariant 13), styled by
      // the template. No voice means no captions: transcribing the render is not an option.
      const captions = spoken
        ? buildAss(
            captionsFromVoiceover(
              spoken.lines,
              spoken.startsSeconds,
              Math.min(spoken.durationSeconds, rendered.length * SECONDS_PER_SCENE),
            ),
            REEL_FRAMES[reelFrame],
            await captionStyle(deps.db, prompt.templateId, prompt.templateVersion),
          )
        : undefined;

      // The reel itself: scenes joined, voice over them, bed ducked under it, logo cornered
      // (plan section 4.6). A render that cannot run leaves the scenes, already paid for.
      say({ key: 'reel', label: 'Cutting the reel', status: 'working' });
      const cuttingFrom = Date.now();
      const reel = await renderReel(
        deps,
        job.workspaceId,
        rendered,
        spoken?.audio,
        captions,
        reelFrame,
        log,
      );
      say({
        key: 'reel',
        label: reel ? 'Cut the reel' : 'The scenes are kept; the reel could not be cut',
        status: reel ? 'done' : 'failed',
        seconds: since(cuttingFrom),
      });
      if (reel) {
        await ws.update(
          outputs,
          {
            storageKey: reel.key,
            metadata: {
              ...(output.metadata as object),
              reel: reel.view,
              // Kept for the captions, which are timed by the voice (invariant 13, WP25).
              ...(spoken ? { voiceover: spoken.view } : {}),
            },
          },
          (t, op) => op.eq(t.id, output.id),
        );
      }

      const seconds = Math.round(delivered);
      return {
        actual: { credits: 0, videoSeconds: Math.min(seconds, job.videoSecondsHeld) },
        telemetry: {
          actionClass: generator.key,
          provider: `${deps.providerLabel}:${adapter.key}`,
          realisedCostInr: deps.costInr(adapter.key, RESOLUTION_TIER, seconds),
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

    const generator = deps.registry
      .list()
      .find((entry) => entry.outputType === 'video' && entry.jobClass === 'render');
    const adapter = generator ? deps.adapters[generator.providerAdapter] : undefined;
    if (!adapter) throw new Error('No video adapter');

    // The reel this scene belongs to already settled on an aspect ratio; redrawing one scene
    // has to match it, not default back to vertical out from under the other scenes it joins.
    const [owner] = await scoped(deps.db, job.workspaceId).select(outputs, {
      where: (t, op) => op.eq(t.id, scene.outputId),
      limit: 1,
    });
    const aspectRatio: VideoAspectRatio =
      (owner?.metadata as { aspectRatio?: unknown })?.aspectRatio === '16:9' ? '16:9' : '9:16';

    const result = await renderScene(deps, adapter, scene.prompt, log, aspectRatio);
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
        realisedCostInr: deps.costInr(adapter.key, RESOLUTION_TIER, seconds),
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
  voice: { data: Uint8Array } | undefined,
  captions: string | undefined,
  reelFrame: ReelResolution,
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
      resolution: reelFrame,
      voice,
      captions,
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

/**
 * The voiceover: one line per scene, spoken once, with the marks that will time the captions.
 * Returns nothing when there is no voice provider, no lines, or the call fails: a silent reel
 * is honest, and a render that dies over its narration would throw away the clips.
 */
async function speak(
  deps: VideoHandlerDeps,
  config: CompilerProfileConfig,
  prompt: string,
  scenes: string[],
  delivered: number,
  log: Parameters<JobHandler>[1],
): Promise<
  | {
      audio: { data: Uint8Array };
      lines: string[];
      startsSeconds: number[];
      durationSeconds: number;
      view: Record<string, unknown>;
    }
  | undefined
> {
  if (!deps.voice || delivered === 0) return undefined;
  const plan = await planVoiceover({
    prompt,
    // Only the scenes that arrived have anything to speak over.
    scenes: scenes.slice(0, delivered),
    config,
    provider: deps.planner,
    log,
  });
  if (plan.lines.length === 0) {
    log.info('no voiceover written; the reel stays silent');
    return undefined;
  }
  try {
    const result = await deps.voice.synthesize({
      segments: plan.lines,
      voice: '',
      language: 'en',
    });
    log.info(
      { seconds: result.durationSeconds, segments: plan.lines.length },
      'voiceover synthesised',
    );
    return {
      audio: { data: result.data },
      lines: plan.lines,
      startsSeconds: result.segmentStartsSeconds,
      durationSeconds: result.durationSeconds,
      view: {
        lines: plan.lines,
        segmentStartsSeconds: result.segmentStartsSeconds,
        durationSeconds: result.durationSeconds,
        adapter: deps.voice.key,
        costInr: deps.voiceCostInr?.(deps.voice.key, plan.lines.join(' ').length) ?? 0,
      },
    };
  } catch (err) {
    log.warn({ err }, 'voiceover could not be spoken; the reel stays silent');
    return undefined;
  }
}

/**
 * How captions look, from the template that made this reel (WP25). A template says it in its
 * video defaults; anything it leaves out keeps the default the spike tuned.
 */
async function captionStyle(
  db: Database,
  templateId: string,
  version: number,
): Promise<CaptionStyle> {
  const [row] = await catalog(db).select(templateVersions, {
    where: (t, op) => op.and(op.eq(t.templateId, templateId), op.eq(t.version, version)),
    limit: 1,
  });
  const style = (row?.videoDefaults as { captionStyle?: Partial<CaptionStyle> } | null)
    ?.captionStyle;
  return { ...DEFAULT_CAPTION_STYLE, ...(style ?? {}) };
}

/** The seconds a reel of this many scenes asks for, which is what the hold is taken on. */
export function videoSecondsFor(sceneCount: number): number {
  return sceneCount * SECONDS_PER_SCENE;
}
