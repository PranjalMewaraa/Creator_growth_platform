import type { Logger } from '@cgp/config';
import type { GeneratedClip, VideoAdapter, VideoPollResult, VideoRequest } from '@cgp/contracts';
import { GoogleGenAI } from '@google/genai';
import { normalizeError } from '../errors';
import { createPacer } from '../pace';
import { mp4Info } from './mp4';

// Gemini Omni 1.1 Flash (WP63, 2026-10-19). Confirmed against the installed @google/genai
// 2.23.0 type definitions and docs.cloud.google.com, but NOT yet proven against the live API
// the way Veo's shapes were (veo.ts's own comment: "what the WP5 spike saw"). Treat the first
// real submit()/poll() pair here as that spike: if the wire shape below is wrong, the error
// will be a thrown AdapterError, not a silent misfire, since nothing here swallows one.
//
// Three things this file does NOT attempt, on purpose, because they are each their own
// decision rather than a default to reach for quietly:
//   - It asks for an 8 second clip, matching Veo's atomic unit, not the model's real 10 second
//     ceiling or its 40 second multi-turn extension — one duration system in Studio, not two.
//   - It leaves `request.startImage` unused: first/last frame control here is two reference
//     images plus a described transition, a different shape than Veo's "animate this still",
//     and conflating them would change what `acceptsStartImage` means for every other caller.
//   - It does nothing about the model's own generated audio colliding with this app's
//     voiceover toggle (WP58) layering a spoken track on top — `generatesAudio: true` is
//     declared honestly in models.ts, and what to do about the overlap is a product decision,
//     not an adapter one.

export interface OmniVideoOptions {
  /** Calls a minute the provider allows, from the model's capability (WP40). */
  requestsPerMinute?: number;
  key: string;
  project: string;
  /** Omni answers on `global`, confirmed on the model's own Vertex page. */
  location: string;
  model: string;
  log?: Logger;
}

type ContentPart =
  | { type: 'image'; data: string; mime_type: string }
  | { type: 'text'; text: string };

interface OmniInteraction {
  id: string;
  status: string;
  output_video?: { data?: string; mime_type?: string } | undefined;
}

export function createOmniVideo(options: OmniVideoOptions): VideoAdapter {
  const ai = new GoogleGenAI({
    vertexai: true,
    project: options.project,
    location: options.location,
  });

  const isQuotaError = (err: unknown): boolean => {
    const status = (err as { status?: number } | null)?.status;
    const message = err instanceof Error ? err.message : String(err);
    return status === 429 || message.includes('429') || message.includes('RESOURCE_EXHAUSTED');
  };
  const pacer = createPacer({ perMinute: options.requestsPerMinute ?? 1, isQuotaError });

  /** The clip describes itself; nothing from submit() is remembered between the two calls. */
  function toClip(base64: string, mimeType: string | undefined): GeneratedClip {
    const data = new Uint8Array(Buffer.from(base64, 'base64'));
    const info = mp4Info(data);
    if (!info) options.log?.warn({ provider: 'omni' }, 'clip header could not be read');
    return {
      data,
      mimeType: mimeType ?? 'video/mp4',
      durationSeconds: info?.durationSeconds ?? 0,
      width: info?.width ?? 0,
      height: info?.height ?? 0,
    };
  }

  return {
    key: options.key,

    async submit(request: VideoRequest) {
      try {
        // No structured aspect-ratio/resolution/duration field exists for this model, only
        // `task` — the model's own docs say to steer the rest through the prompt text.
        const instruction =
          `${request.prompt}\n\nRender at ${request.aspectRatio}, ${request.resolution}, ` +
          `exactly ${request.durationSeconds} seconds.`;
        // Pictures first, then the words, the same ordering reasoning as the image adapter's
        // own reference handling (WP39): a reference offered after the instruction is a
        // weaker anchor than one offered before it.
        const input: ContentPart[] = [
          ...(request.references ?? []).map(
            (reference): ContentPart => ({
              type: 'image',
              data: Buffer.from(reference.data).toString('base64'),
              mime_type: reference.mimeType,
            }),
          ),
          { type: 'text', text: instruction },
        ];
        const interaction = (await pacer.run(() =>
          ai.interactions.create({
            model: options.model,
            input,
            background: true,
            generation_config: {
              video_config: {
                task: request.references?.length ? 'reference_to_video' : 'text_to_video',
              },
            },
          }),
        )) as OmniInteraction;
        return { operationId: interaction.id };
      } catch (err) {
        throw normalizeError('omni', err, options.log);
      }
    },

    async poll(operationId): Promise<VideoPollResult> {
      let interaction: OmniInteraction;
      try {
        interaction = (await ai.interactions.get(operationId)) as OmniInteraction;
      } catch (err) {
        throw normalizeError('omni', err, options.log);
      }

      if (interaction.status === 'queued' || interaction.status === 'in_progress') {
        return { status: 'running' };
      }
      if (interaction.status !== 'completed') {
        return {
          status: 'failed',
          error: {
            code: `OMNI_${interaction.status.toUpperCase()}`,
            message: 'omni could not generate this clip',
            category: 'terminal',
          },
        };
      }

      const video = interaction.output_video;
      if (!video?.data) {
        options.log?.info({ status: interaction.status }, 'omni returned no clip');
        return {
          status: 'failed',
          error: {
            code: 'NO_CLIP',
            message: 'omni finished without returning a clip',
            category: 'terminal',
          },
        };
      }
      return { status: 'done', clip: toClip(video.data, video.mime_type) };
    },
  };
}
