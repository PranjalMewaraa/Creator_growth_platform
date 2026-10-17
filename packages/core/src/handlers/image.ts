import type {
  AspectRatio,
  ImageAdapter,
  ImageCapability,
  ModerationAdapter,
  ObjectStore,
  OutputType,
  TokenUsage,
} from '@cgp/contracts';
import { isAdapterError } from '@cgp/contracts';
import { outputs, scoped, type Database } from '@cgp/db';
import { findCompiledPrompt, settingValue } from '@cgp/orchestration';
import { THUMBNAIL_VARIANTS } from '../generators/definitions';
import type { GeneratorRegistry } from '../generators/registry';
import { postCheckOutput } from '../moderation';
import { JobBlocked, type JobHandler } from '../process';

const IMAGE_OUTPUTS: ReadonlySet<OutputType> = new Set(['image', 'thumbnail']);

const RATIOS: ReadonlySet<string> = new Set(['1:1', '4:5', '9:16', '16:9']);

/**
 * The frame when the request names no platform: a square post, a wide thumbnail. With a
 * platform the compiler has already resolved the ratio, and that one outranks this.
 */
const UNTARGETED: Record<'image' | 'thumbnail', AspectRatio> = {
  image: '1:1',
  thumbnail: '16:9',
};

const EXTENSIONS: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg' };

export interface ImageHandlerDeps {
  db: Database;
  registry: GeneratorRegistry;
  /** By model key, as generators name them in `providerAdapter`. */
  adapters: Readonly<Record<string, ImageAdapter>>;
  /** Checks every picture before any of it is stored or given a public URL. */
  moderation: ModerationAdapter;
  store: ObjectStore;
  /** Realised cost for telemetry; zero for fakes. */
  costInr: (adapterKey: string, usage: TokenUsage) => number;
  /** Recorded as the telemetry provider, such as `vertex` or `fake`. */
  providerLabel: string;
  capabilityOf?: (adapterKey: string) => ImageCapability | undefined;
}

interface ImageJobInput {
  compiledPromptId?: unknown;
  count?: unknown;
  /** A picture the creator uploaded to stay consistent with, by its store key (WP60). */
  referenceImageKey?: unknown;
}

/** Inferred from the extension `storeReferenceImage` chose; the store returns bytes alone. */
function mimeTypeFor(key: string): string {
  return key.endsWith('.png') ? 'image/png' : 'image/jpeg';
}

/**
 * Handlers for every image generator in the registry. The prompt is run exactly as compiled
 * (invariant 4) and the frame comes from the prompt's resolved settings, which the target
 * platform decided: the user is never asked for an aspect ratio.
 */
export function createImageHandlers(deps: ImageHandlerDeps): Record<string, JobHandler> {
  const handlers: Record<string, JobHandler> = {};
  for (const generator of deps.registry.list()) {
    if (!IMAGE_OUTPUTS.has(generator.outputType)) continue;
    const kind = generator.outputType as 'image' | 'thumbnail';

    handlers[generator.key] = async (job, log) => {
      const ws = scoped(deps.db, job.workspaceId);
      const settled = { actual: { credits: job.creditsHeld, videoSeconds: 0 } };

      // A redelivered job whose images already exist is not generated, or paid for, twice.
      const [existing] = await ws.select(outputs, { where: (t, op) => op.eq(t.jobId, job.id) });
      if (existing) {
        log.info({ jobId: job.id }, 'output already stored, settling without a provider call');
        return {
          ...settled,
          telemetry: {
            actionClass: generator.key,
            provider: deps.providerLabel,
            realisedCostInr: 0,
          },
        };
      }

      const input = job.input as ImageJobInput;
      if (typeof input.compiledPromptId !== 'string') throw new Error('Job has no compiled prompt');
      const prompt = await findCompiledPrompt(deps.db, job.workspaceId, input.compiledPromptId);
      if (!prompt) throw new Error('Compiled prompt not found');

      const adapter = deps.adapters[generator.providerAdapter];
      if (!adapter) throw new Error(`No image adapter ${generator.providerAdapter}`);

      // A thumbnail is always a set of variants to choose between; an image is what was priced.
      const count =
        kind === 'thumbnail'
          ? THUMBNAIL_VARIANTS
          : typeof input.count === 'number' && input.count > 0
            ? input.count
            : 1;
      const resolved = settingValue(prompt.settings, 'aspectRatio');
      const aspectRatio =
        typeof resolved === 'string' && RATIOS.has(resolved)
          ? (resolved as AspectRatio)
          : UNTARGETED[kind];

      // Only a model that says it reads them is given one (WP60, same reasoning as the
      // storyboard's own anchor frame) — an uploaded reference is otherwise silently dropped
      // rather than sent to a model that would ignore or reject it.
      const acceptsReferences = deps.capabilityOf?.(adapter.key)?.acceptsReferenceImages ?? false;
      let references: Array<{ data: Uint8Array; mimeType: string }> | undefined;
      if (acceptsReferences && typeof input.referenceImageKey === 'string') {
        try {
          const data = await deps.store.get(input.referenceImageKey);
          references = [{ data, mimeType: mimeTypeFor(input.referenceImageKey) }];
        } catch (err) {
          log.warn({ err, key: input.referenceImageKey }, 'reference image could not be read');
        }
      }

      let result;
      try {
        result = await adapter.generate({
          prompt: prompt.text,
          aspectRatio,
          count,
          ...(references ? { references } : {}),
        });
      } catch (err) {
        // A refusal to draw is a moderation outcome, not a failure: refunded as BLOCKED.
        if (isAdapterError(err) && err.code === 'SAFETY_BLOCKED') throw new JobBlocked('other');
        throw err;
      }
      if (result.images.length === 0) throw new Error(`${adapter.key} returned no images`);

      // Every picture is checked before it is stored, so a blocked one never reaches the
      // bucket, where it would have a public URL (WP16).
      const flagged = await postCheckOutput(
        { db: deps.db, moderation: deps.moderation, log },
        job,
        { media: result.images },
      );
      if (flagged) throw new JobBlocked(flagged);

      // Stored one row per image, so a variant can be picked, posted or reused on its own.
      for (const [index, image] of result.images.entries()) {
        const extension = EXTENSIONS[image.mimeType] ?? 'png';
        const key = `${job.workspaceId}/generated/${job.id}/${index}.${extension}`;
        const stored = await deps.store.put(key, image.data, image.mimeType);
        await ws.insert(outputs, {
          jobId: job.id,
          kind: generator.outputType,
          storageKey: stored.key,
          metadata: {
            url: stored.url,
            mimeType: stored.mimeType,
            bytes: stored.bytes,
            width: image.width,
            height: image.height,
            aspectRatio,
            adapter: adapter.key,
          },
          compiledPromptId: prompt.id,
          templateId: prompt.templateId,
          brandKitVersion: prompt.brandKitVersion,
        });
      }

      return {
        ...settled,
        telemetry: {
          actionClass: generator.key,
          provider: `${deps.providerLabel}:${adapter.key}`,
          realisedCostInr: deps.costInr(adapter.key, result.usage),
          tokensIn: result.usage.inputTokens,
          tokensOut: result.usage.outputTokens,
        },
      };
    };
  }
  return handlers;
}
