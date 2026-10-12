import type {
  CompilerProfileConfig,
  ImageAdapter,
  ModerationAdapter,
  ImageCapability,
  JobStage,
  MediaBytes,
  ObjectStore,
  TextAdapter,
  TokenUsage,
} from '@cgp/contracts';
import { catalog, compilerProfiles, outputs, scoped, type Database } from '@cgp/db';
import { findCompiledPrompt, planScenes } from '@cgp/orchestration';
import type { GeneratorRegistry } from '../generators/registry';
import { postCheckOutput } from '../moderation';
import { JobBlocked, type JobHandler } from '../process';

/**
 * The storyboard (WP26): the scenes a reel would be made of, drawn as stills before anything
 * is filmed. A still costs about a rupee of provider time and a clip about twenty one, so this
 * is where a creator finds out the reel is wrong.
 *
 * The scene prompts are kept with it, and committing to a render reuses them, so the reel
 * films what was approved rather than a fresh plan that happens to be close.
 */

export const STORYBOARD = 'storyboard';

/**
 * What the model is told when it is also shown the first frame. The instruction is about the
 * world, not the framing: each scene is its own shot, and copying the first one's composition
 * would make a storyboard of three near identical pictures.
 */
export function sameWorldAs(scenePrompt: string): string {
  return [
    scenePrompt,
    '',
    'Continuity: the attached picture is an earlier scene from this same piece. Keep the same',
    'place, the same people and their clothing, the same objects and the same light and colour',
    'as that picture. Frame this scene as described above, not as the attached one is framed.',
  ].join(String.fromCharCode(10));
}

/** Vertical, like the reel it previews. */
export const ASPECT_RATIO = '9:16' as const;

export interface StoryboardHandlerDeps {
  db: Database;
  registry: GeneratorRegistry;
  adapters: Readonly<Record<string, ImageAdapter>>;
  /** Plans the scenes: the engine's provider, the same one the render would use. */
  planner: TextAdapter | undefined;
  moderation: ModerationAdapter;
  store: ObjectStore;
  costInr: (adapterKey: string, usage: TokenUsage) => number;
  providerLabel: string;
  /** What the chosen model will draw, so references are offered only where they are read. */
  capabilityOf?: (adapterKey: string) => ImageCapability | undefined;
  /**
   * Says what is happening, as it happens (WP44). Best effort: nobody listening is fine, and a
   * failure to say so never fails the work.
   */
  publishStage?: (jobId: string, stage: JobStage) => Promise<void>;
}

interface StoryboardInput {
  compiledPromptId?: unknown;
  sceneCount?: unknown;
}

export function createStoryboardHandler(deps: StoryboardHandlerDeps): Record<string, JobHandler> {
  const generator = deps.registry.get(STORYBOARD);
  if (!generator) return {};

  return {
    [STORYBOARD]: async (job, log) => {
      const ws = scoped(deps.db, job.workspaceId);
      const settled = { actual: { credits: job.creditsHeld, videoSeconds: 0 } };

      const [existing] = await ws.select(outputs, { where: (t, op) => op.eq(t.jobId, job.id) });
      if (existing) {
        log.info({ jobId: job.id }, 'storyboard already drawn, settling without a provider call');
        return {
          ...settled,
          telemetry: {
            actionClass: STORYBOARD,
            provider: deps.providerLabel,
            realisedCostInr: 0,
          },
        };
      }

      const input = job.input as StoryboardInput;
      if (typeof input.compiledPromptId !== 'string') throw new Error('Job has no compiled prompt');
      const prompt = await findCompiledPrompt(deps.db, job.workspaceId, input.compiledPromptId);
      if (!prompt) throw new Error('Compiled prompt not found');

      const adapter = deps.adapters[generator.providerAdapter];
      if (!adapter) throw new Error(`No image adapter ${generator.providerAdapter}`);

      const [profile] = await catalog(deps.db).select(compilerProfiles, {
        where: (t, op) =>
          op.and(
            op.eq(t.key, prompt.compilerProfileKey),
            op.eq(t.version, prompt.compilerProfileVersion),
          ),
        limit: 1,
      });
      const config = profile?.config as CompilerProfileConfig | undefined;
      if (!config) throw new Error(`${prompt.compilerProfileKey} is missing`);

      const sceneCount =
        typeof input.sceneCount === 'number' && input.sceneCount > 0 ? input.sceneCount : 3;
      const say = (stage: JobStage) =>
        void deps.publishStage?.(job.id, stage).catch(() => undefined);
      const started = Date.now();
      const since = (from: number) => Math.round((Date.now() - from) / 100) / 10;

      say({ key: 'plan', label: 'Planning the scenes', status: 'working' });
      const plan = await planScenes({
        prompt: prompt.text,
        config,
        sceneCount,
        provider: deps.planner,
        log,
      });

      say({ key: 'plan', label: 'Planning the scenes', status: 'done', seconds: since(started) });

      // One still per scene, drawn one at a time: the image quota is metered by the minute and
      // a burst of three loses the set rather than one frame.
      const frames: Array<{ index: number; prompt: string; url: string; key: string }> = [];
      let usage: TokenUsage = { inputTokens: 0, outputTokens: 0 };
      let blocked = false;
      // The first frame, kept to show the model while it draws the rest (WP39). Scenes drawn
      // independently come back as three different kitchens with three different hands; a reel
      // made of those reads as a machine's work however good each frame is on its own.
      let anchor: MediaBytes | undefined;
      const references = deps.capabilityOf?.(adapter.key)?.acceptsReferenceImages ?? false;

      const perMinute = deps.capabilityOf?.(adapter.key)?.requestsPerMinute;
      for (const [index, scenePrompt] of plan.scenes.entries()) {
        const drawingFrom = Date.now();
        say({
          key: `frame-${index}`,
          label: 'Drawing the frame',
          status: 'working',
          index: index + 1,
          total: plan.scenes.length,
          // Told rather than hidden: from the third frame on there is a real wait, and saying
          // why turns it from a stall into a known cost (WP40).
          ...(perMinute && index + 1 > perMinute
            ? { note: `waiting for the picture model, which allows ${perMinute} a minute` }
            : {}),
        });
        const result = await adapter.generate({
          prompt: references && anchor ? sameWorldAs(scenePrompt) : scenePrompt,
          aspectRatio: ASPECT_RATIO,
          count: 1,
          ...(references && anchor ? { references: [anchor] } : {}),
        });
        const image = result.images[0];
        if (!image) continue;
        usage = {
          inputTokens: usage.inputTokens + result.usage.inputTokens,
          outputTokens: usage.outputTokens + result.usage.outputTokens,
        };

        const checked = await postCheckOutput(
          { db: deps.db, moderation: deps.moderation, log },
          job,
          { media: [{ data: image.data, mimeType: image.mimeType }] },
        );
        if (checked) {
          blocked = true;
          continue;
        }
        const extension = image.mimeType === 'image/png' ? 'png' : 'jpg';
        const stored = await deps.store.put(
          `${job.workspaceId}/storyboards/${job.id}/${index}.${extension}`,
          image.data,
          image.mimeType,
        );
        // The key as well as the url: filming this frame later needs the bytes back, and
        // picking a key out of a public url means knowing how one store spells them (WP33).
        frames.push({ index, prompt: scenePrompt, url: stored.url, key: stored.key });
        // The frame is shown the moment it exists, rather than all three at the end.
        say({
          key: `frame-${index}`,
          label: 'Drew the frame',
          status: 'done',
          index: index + 1,
          total: plan.scenes.length,
          url: stored.url,
          seconds: since(drawingFrom),
        });
        // Every later frame looks at the first, not at the one before it: following the chain
        // lets the look drift a step at a time until scene three has left scene one behind.
        anchor ??= { data: image.data, mimeType: image.mimeType };
      }

      if (frames.length === 0) {
        if (blocked) throw new JobBlocked('other');
        throw new Error('No storyboard frame could be drawn');
      }

      await ws.insert(outputs, {
        jobId: job.id,
        kind: 'video',
        storageKey: `${job.workspaceId}/storyboards/${job.id}`,
        metadata: {
          storyboard: frames,
          // What the render will film, so committing does not re-plan and drift.
          scenePrompts: plan.scenes,
          scenePlanFallback: plan.fallbackUsed,
          sceneCount,
          adapter: adapter.key,
        },
        compiledPromptId: prompt.id,
        templateId: prompt.templateId,
        brandKitVersion: prompt.brandKitVersion,
      });

      return {
        ...settled,
        telemetry: {
          actionClass: STORYBOARD,
          provider: `${deps.providerLabel}:${adapter.key}`,
          realisedCostInr: deps.costInr(adapter.key, usage),
          tokensIn: usage.inputTokens,
          tokensOut: usage.outputTokens,
        },
      };
    },
  };
}

export interface StoryboardFrame {
  index: number;
  prompt: string;
  /** Where the still is, so the render can film the picture rather than the words (WP38). */
  key: string;
}

/**
 * The frames a storyboard drew, for a render that animates them. Frames drawn before WP38
 * carry no key and are left out: those reels film from the scene prompts, as they always did.
 */
export async function storyboardFrames(
  db: Database,
  workspaceId: string,
  outputId: string,
): Promise<StoryboardFrame[]> {
  const [output] = await scoped(db, workspaceId).select(outputs, {
    where: (t, op) => op.eq(t.id, outputId),
    limit: 1,
  });
  const frames = (output?.metadata as { storyboard?: unknown } | undefined)?.storyboard;
  if (!Array.isArray(frames)) return [];
  return frames.flatMap((frame) => {
    const { index, prompt, key } = (frame ?? {}) as Record<string, unknown>;
    return typeof index === 'number' && typeof key === 'string' && key.length > 0
      ? [{ index, prompt: typeof prompt === 'string' ? prompt : '', key }]
      : [];
  });
}

/** The scene prompts a storyboard approved, for the render that commits to them. */
export async function storyboardScenes(
  db: Database,
  workspaceId: string,
  outputId: string,
): Promise<string[] | undefined> {
  const [output] = await scoped(db, workspaceId).select(outputs, {
    where: (t, op) => op.eq(t.id, outputId),
    limit: 1,
  });
  const prompts = (output?.metadata as { scenePrompts?: unknown } | undefined)?.scenePrompts;
  if (!Array.isArray(prompts)) return undefined;
  const usable = prompts.filter((prompt): prompt is string => typeof prompt === 'string');
  return usable.length > 0 ? usable : undefined;
}
