import type { JobStage, MediaBytes } from '@cgp/contracts';
import { outputs, scoped } from '@cgp/db';
import { findCompiledPrompt } from '@cgp/orchestration';
import { postCheckOutput } from '../moderation';
import { JobBlocked, type JobHandler } from '../process';
import { ASPECT_RATIO, sameWorldAs, type StoryboardHandlerDeps } from './storyboard';

/**
 * One frame of a storyboard, drawn again (WP50).
 *
 * Nothing is overwritten. The redraw writes a new storyboard output carrying the other frames
 * unchanged and this one replaced, so the strip before and the strip after both still exist,
 * and filming commits to whichever was approved. A redraw that comes back worse costs one
 * picture rather than the storyboard.
 *
 * Continuity is kept against a frame that is not this one (WP39). Every frame was drawn
 * against the first, so any of the others carries the same world; showing the model the frame
 * it is replacing would ask it to redraw what is already there, which is the one thing a
 * redraw is not for.
 */
export const REDRAW_FRAME = 'redraw_frame';

/** The planner belongs to the storyboard: a redraw has a scene already and must not re-plan. */
export type RedrawFrameHandlerDeps = Omit<StoryboardHandlerDeps, 'planner'>;

interface RedrawInput {
  compiledPromptId?: unknown;
  storyboardOutputId?: unknown;
  frameIndex?: unknown;
  note?: unknown;
}

/** A frame as a storyboard output stores it. */
interface StoredFrame {
  index: number;
  prompt: string;
  url: string;
  key: string;
}

function storedFrames(metadata: unknown): StoredFrame[] {
  const frames = (metadata as { storyboard?: unknown } | null)?.storyboard;
  if (!Array.isArray(frames)) return [];
  return frames.flatMap((frame) => {
    const { index, prompt, url, key } = (frame ?? {}) as Record<string, unknown>;
    if (typeof index !== 'number' || typeof url !== 'string') return [];
    return [
      {
        index,
        prompt: typeof prompt === 'string' ? prompt : '',
        url,
        key: typeof key === 'string' ? key : '',
      },
    ];
  });
}

/** What the user says is wrong, after the scene this is still a frame of rather than instead. */
function withNote(scenePrompt: string, note: string | undefined): string {
  if (!note) return scenePrompt;
  return [scenePrompt, '', `Change this: ${note}`].join(String.fromCharCode(10));
}

export function createRedrawFrameHandler(deps: RedrawFrameHandlerDeps): Record<string, JobHandler> {
  const generator = deps.registry.get(REDRAW_FRAME);
  if (!generator) return {};

  return {
    [REDRAW_FRAME]: async (job, log) => {
      const ws = scoped(deps.db, job.workspaceId);
      const settled = { actual: { credits: job.creditsHeld, videoSeconds: 0 } };
      const input = job.input as RedrawInput;

      const [already] = await ws.select(outputs, { where: (t, op) => op.eq(t.jobId, job.id) });
      if (already) {
        log.info({ jobId: job.id }, 'frame already redrawn, settling without a provider call');
        return {
          ...settled,
          telemetry: {
            actionClass: REDRAW_FRAME,
            provider: deps.providerLabel,
            realisedCostInr: 0,
          },
        };
      }

      const { storyboardOutputId, frameIndex, compiledPromptId } = input;
      if (typeof storyboardOutputId !== 'string') throw new Error('Job has no storyboard');
      if (typeof frameIndex !== 'number') throw new Error('Job has no frame');
      if (typeof compiledPromptId !== 'string') throw new Error('Job has no compiled prompt');

      const prompt = await findCompiledPrompt(deps.db, job.workspaceId, compiledPromptId);
      if (!prompt) throw new Error('Compiled prompt not found');

      const [source] = await ws.select(outputs, {
        where: (t, op) => op.eq(t.id, storyboardOutputId),
        limit: 1,
      });
      if (!source) throw new Error('Storyboard not found');
      const frames = storedFrames(source.metadata);
      const frame = frames.find((f) => f.index === frameIndex);
      if (!frame) throw new Error('Storyboard has no such frame');

      const adapter = deps.adapters[generator.providerAdapter];
      if (!adapter) throw new Error(`No image adapter ${generator.providerAdapter}`);

      const say = (stage: JobStage) =>
        void deps.publishStage?.(job.id, stage).catch(() => undefined);
      const started = Date.now();
      const note = typeof input.note === 'string' ? input.note : undefined;
      const scene = withNote(frame.prompt, note);

      let anchor: MediaBytes | undefined;
      const references = deps.capabilityOf?.(adapter.key)?.acceptsReferenceImages ?? false;
      const other = frames.find((f) => f.index !== frame.index && f.key.length > 0);
      if (references && other) {
        try {
          anchor = {
            data: await deps.store.get(other.key),
            mimeType: other.key.endsWith('.png') ? 'image/png' : 'image/jpeg',
          };
        } catch (err) {
          // Worth drawing anyway; it just cannot promise the same world as the others.
          log.warn({ err, key: other.key }, 'reference frame unreadable; redrawing without it');
        }
      }

      say({
        key: 'redraw',
        label: 'Drawing the frame again',
        status: 'working',
        index: frame.index + 1,
        total: frames.length,
      });

      const result = await adapter.generate({
        prompt: anchor ? sameWorldAs(scene) : scene,
        aspectRatio: ASPECT_RATIO,
        count: 1,
        ...(anchor ? { references: [anchor] } : {}),
      });
      const image = result.images[0];
      if (!image) throw new Error('The frame could not be drawn');

      const checked = await postCheckOutput(
        { db: deps.db, moderation: deps.moderation, log },
        job,
        { media: [{ data: image.data, mimeType: image.mimeType }] },
      );
      if (checked) throw new JobBlocked(checked);

      // Under this job's own id, so a redraw can never write over the frame it replaces.
      const extension = image.mimeType === 'image/png' ? 'png' : 'jpg';
      const stored = await deps.store.put(
        `${job.workspaceId}/storyboards/${job.id}/${frame.index}.${extension}`,
        image.data,
        image.mimeType,
      );

      const redrawn = frames
        .map((f) => (f.index === frame.index ? { ...f, url: stored.url, key: stored.key } : f))
        .sort((a, b) => a.index - b.index);

      await ws.insert(outputs, {
        jobId: job.id,
        kind: 'video',
        storageKey: `${job.workspaceId}/storyboards/${job.id}`,
        metadata: {
          // The scene prompts come with it: this strip films what the first one approved.
          ...(source.metadata as Record<string, unknown>),
          storyboard: redrawn,
          // Which strip this came from and what changed, so the chain can be read back.
          redrawOf: source.id,
          redrawnFrame: frame.index,
          ...(note ? { redrawNote: note } : {}),
        },
        compiledPromptId: prompt.id,
        templateId: prompt.templateId,
        brandKitVersion: prompt.brandKitVersion,
      });

      say({
        key: 'redraw',
        label: 'Drew the frame again',
        status: 'done',
        index: frame.index + 1,
        total: frames.length,
        url: stored.url,
        seconds: Math.round((Date.now() - started) / 100) / 10,
      });

      return {
        ...settled,
        telemetry: {
          actionClass: REDRAW_FRAME,
          provider: `${deps.providerLabel}:${adapter.key}`,
          realisedCostInr: deps.costInr(adapter.key, result.usage),
          tokensIn: result.usage.inputTokens,
          tokensOut: result.usage.outputTokens,
        },
      };
    },
  };
}
