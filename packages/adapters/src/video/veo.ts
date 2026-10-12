import type { Logger } from '@cgp/config';
import {
  AdapterError,
  type GeneratedClip,
  type VideoAdapter,
  type VideoPollResult,
  type VideoRequest,
} from '@cgp/contracts';
import { createPacer } from '../pace';
import { GoogleAuth } from 'google-auth-library';
import { categoryForStatus, normalizeError } from '../errors';
import { mp4Info } from './mp4';

// Veo 3.1 Lite on Vertex (WP21, plan section 6). Long running: submit returns an operation
// name, and the caller polls it. Nothing here waits in a loop, because the worker owns the
// waiting and a render job must survive a restart.
//
// The shapes below are what the WP5 spike saw on 2026-09-18, against
// veo-3.1-lite-generate-001 in us-central1.

export interface VeoOptions {
  /** Submissions a minute the provider allows, from the model's capability (WP41). */
  requestsPerMinute?: number;
  /** How many times a refusal is waited out. Zero in tests, which have no minutes to spare. */
  quotaRetries?: number;
  key: string;
  project: string;
  /** Veo is regional, unlike Gemini 3.x, which answers on `global` (D10). */
  location: string;
  model: string;
  log?: Logger;
  /** Tests pass a fetch that never leaves the machine, and auth that needs no login. */
  fetch?: typeof fetch;
  authHeaders?: (url: string) => Promise<ConstructorParameters<typeof Headers>[0]>;
}

interface Operation {
  name?: string;
  done?: boolean;
  error?: { code?: number; message?: string };
  response?: {
    raiMediaFilteredCount?: number;
    raiMediaFilteredReasons?: string[];
    videos?: Array<{ bytesBase64Encoded?: string; mimeType?: string }>;
  };
}

class HttpError extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status}`);
  }
}

/** Frame sizes for the two ratios Veo takes, at each resolution it offers. */
const FRAMES: Record<
  VideoRequest['aspectRatio'],
  Record<VideoRequest['resolution'], [number, number]>
> = {
  '9:16': { '720p': [720, 1280], '1080p': [1080, 1920] },
  '16:9': { '720p': [1280, 720], '1080p': [1920, 1080] },
};

export function createVeoVideo(options: VeoOptions): VideoAdapter {
  const doFetch = options.fetch ?? fetch;
  const authHeaders =
    options.authHeaders ??
    (() => {
      const auth = new GoogleAuth({ scopes: 'https://www.googleapis.com/auth/cloud-platform' });
      return async (url: string) => (await auth.getClient()).getRequestHeaders(url);
    })();

  const base =
    `https://${options.location}-aiplatform.googleapis.com/v1/projects/${options.project}` +
    `/locations/${options.location}/publishers/google/models/${options.model}`;

  async function post<T>(action: string, body: unknown): Promise<T> {
    const url = `${base}:${action}`;
    const headers = new Headers(await authHeaders(url));
    headers.set('x-goog-user-project', options.project);
    headers.set('content-type', 'application/json');
    const response = await doFetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
    // The provider's own error text never crosses this boundary (invariant 3).
    if (!response.ok) throw new HttpError(response.status);
    return (await response.json()) as T;
  }

  function fail(err: unknown): AdapterError {
    if (err instanceof HttpError) {
      options.log?.warn({ provider: 'veo', status: err.status }, 'provider call failed');
      return new AdapterError({
        code: `HTTP_${err.status}`,
        message: `veo request failed with HTTP ${err.status}`,
        category: categoryForStatus(err.status),
      });
    }
    return normalizeError('veo', err, options.log);
  }

  /** Node's Buffer, kept to this one line so the rest stays runtime agnostic. */
  const base64 = (data: Uint8Array) => Buffer.from(data).toString('base64');

  /**
   * One submission a minute is what the quota allows, so submissions are paced rather than
   * left to arrive whenever a scene is ready. Sequential rendering happens to respect this
   * today because a clip takes about as long as the window; that is luck, and a faster model
   * would turn it into a stream of refusals (WP41).
   */
  const pacer = createPacer({
    perMinute: options.requestsPerMinute ?? 1,
    ...(options.quotaRetries === undefined ? {} : { retries: options.quotaRetries }),
    isQuotaError: (err: unknown) => {
      const status = (err as { status?: number } | null)?.status;
      const message = err instanceof Error ? err.message : String(err);
      return status === 429 || message.includes('429') || message.includes('RESOURCE_EXHAUSTED');
    },
  });

  return {
    key: options.key,

    async submit(request) {
      try {
        const operation = await pacer.run(() =>
          post<Operation>('predictLongRunning', {
            instances: [
              {
                prompt: request.prompt,
                // Veo animates from a still when it is given one (WP38): the image rides in
                // the instance beside the prompt, base64 encoded, with its own mime type.
                ...(request.startImage
                  ? {
                      image: {
                        bytesBase64Encoded: base64(request.startImage.data),
                        mimeType: request.startImage.mimeType,
                      },
                    }
                  : {}),
              },
            ],
            parameters: {
              aspectRatio: request.aspectRatio,
              durationSeconds: request.durationSeconds,
              resolution: request.resolution,
              sampleCount: 1,
              ...(request.negativePrompt ? { negativePrompt: request.negativePrompt } : {}),
              ...(request.seed === undefined ? {} : { seed: request.seed }),
              // Voiceover and music are added in the render, and audio is billed at a higher
              // rate: the plan prices video only (plan section 6).
              generateAudio: false,
            },
          }),
        );
        if (!operation.name) {
          throw new AdapterError({
            code: 'NO_OPERATION',
            message: 'veo accepted the request without returning an operation',
            category: 'retriable',
          });
        }
        return { operationId: operation.name };
      } catch (err) {
        throw fail(err);
      }
    },

    async poll(operationId): Promise<VideoPollResult> {
      let operation: Operation;
      try {
        operation = await post<Operation>('fetchPredictOperation', { operationName: operationId });
      } catch (err) {
        throw fail(err);
      }
      if (!operation.done) return { status: 'running' };

      if (operation.error) {
        return {
          status: 'failed',
          error: {
            code: `VEO_${operation.error.code ?? 'ERROR'}`,
            message: 'veo could not generate this clip',
            category: 'terminal',
          },
        };
      }

      // A clip the safety filter removed comes back done, with nothing in it.
      const filtered = operation.response?.raiMediaFilteredCount ?? 0;
      const video = operation.response?.videos?.[0];
      if (!video?.bytesBase64Encoded) {
        options.log?.info(
          { filtered, reasons: operation.response?.raiMediaFilteredReasons },
          'veo returned no clip',
        );
        return {
          status: 'failed',
          error: {
            code: filtered > 0 ? 'SAFETY_FILTERED' : 'NO_CLIP',
            message:
              filtered > 0
                ? 'veo refused to generate this clip'
                : 'veo finished without returning a clip',
            category: 'terminal',
          },
        };
      }
      return { status: 'done', clip: toClip(video.bytesBase64Encoded, video.mimeType) };
    },
  };

  /**
   * The clip describes itself. Nothing is remembered from the submit: one adapter serves every
   * job, and a worker that restarts mid render has forgotten what it asked for anyway.
   */
  function toClip(base64: string, mimeType: string | undefined): GeneratedClip {
    const data = new Uint8Array(Buffer.from(base64, 'base64'));
    const info = mp4Info(data);
    if (!info) options.log?.warn({ provider: 'veo' }, 'clip header could not be read');
    return {
      data,
      mimeType: mimeType ?? 'video/mp4',
      durationSeconds: info?.durationSeconds ?? 0,
      width: info?.width ?? 0,
      height: info?.height ?? 0,
    };
  }
}

/** The frame a request asks for, exported so callers and tests agree on it. */
export function veoFrame(
  aspectRatio: VideoRequest['aspectRatio'],
  resolution: VideoRequest['resolution'],
): [number, number] {
  return FRAMES[aspectRatio][resolution];
}
