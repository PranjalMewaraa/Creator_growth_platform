import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  AdapterError,
  FAILURE_CATEGORIES,
  MODERATION_CATEGORIES,
  type AspectRatio,
  type ImageAdapter,
  type ModerationAdapter,
  type Publisher,
  type TargetPlatform,
  type VideoAdapter,
  type VoiceAdapter,
} from '@cgp/contracts';
import { colourFor, silentWav, solidPng } from './media';

// Fakes for every adapter kind (PROVIDERS=fake): real, openable media, no provider, no cost.
// Markers in the input drive the unhappy paths: `FAKE_FAIL:<category>` fails with that
// category, `FAKE_BLOCK:<category>` is flagged by moderation.

/** Runs synchronous fake work so that a throw becomes a rejected promise, like a real call. */
export function attempt<T>(work: () => T): Promise<T> {
  try {
    return Promise.resolve(work());
  } catch (err) {
    return Promise.reject(err instanceof Error ? err : new Error(String(err)));
  }
}

/** A cancelled fake call fails the way a real one does, so callers can test both the same. */
function failIfCancelled(key: string, signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return;
  throw new AdapterError({
    code: 'ABORTED',
    message: `${key} request was cancelled or timed out`,
    category: 'retriable',
  });
}

function failIfAsked(key: string, text: string): void {
  const failure = /FAKE_FAIL:(\w+)/.exec(text)?.[1];
  if (!failure) return;
  const category = FAILURE_CATEGORIES.find((c) => c === failure) ?? 'terminal';
  throw new AdapterError({ code: 'FAKE_FAILURE', message: `${key} fake failure`, category });
}

const FAKE_SIZE: Record<AspectRatio, [number, number]> = {
  '1:1': [256, 256],
  '4:5': [256, 320],
  '9:16': [180, 320],
  '16:9': [320, 180],
};

export function createFakeImage(key = 'fake-image'): ImageAdapter {
  return {
    key,
    generate(request) {
      return attempt(() => {
        failIfCancelled(key, request.signal);
        failIfAsked(key, request.prompt);
        const [width, height] = FAKE_SIZE[request.aspectRatio];
        const images = Array.from({ length: request.count }, (_, i) => ({
          data: solidPng(width, height, colourFor(`${request.prompt}#${i}`)),
          mimeType: 'image/png',
          width,
          height,
        }));
        return { images, usage: { inputTokens: 0, outputTokens: 0 } };
      });
    },
  };
}

// 8s, 180x320, 24 fps, no audio: the shape Veo returns with generateAudio off.
// Read on first use rather than at import, so bundles that never run the fake video (the web
// app) do not need the fixture on disk.
let fakeClip: Uint8Array | undefined;
function clip(): Uint8Array {
  return (fakeClip ??= readFileSync(
    fileURLToPath(new URL('../../fixtures/fake-clip.mp4', import.meta.url)),
  ));
}

export function createFakeVideo(key = 'fake-video'): VideoAdapter {
  const polls = new Map<string, number>();
  return {
    key,
    submit(request) {
      return attempt(() => {
        failIfAsked(key, request.prompt);
        const operationId = `fake-op-${randomUUID()}`;
        polls.set(operationId, 0);
        return { operationId };
      });
    },
    poll(operationId) {
      return attempt(() => {
        const count = polls.get(operationId);
        if (count === undefined) {
          throw new AdapterError({
            code: 'NOT_FOUND',
            message: `${key} has no such operation`,
            category: 'terminal',
          });
        }
        polls.set(operationId, count + 1);
        // Running once, then done, so callers exercise their polling loop.
        if (count === 0) return { status: 'running' as const };
        return {
          status: 'done' as const,
          clip: {
            data: clip(),
            mimeType: 'video/mp4',
            durationSeconds: 8,
            width: 180,
            height: 320,
          },
        };
      });
    },
  };
}

const SECONDS_PER_WORD = 0.35;
const PAUSE_BETWEEN_SEGMENTS = 0.2;

export function createFakeVoice(key = 'fake-voice'): VoiceAdapter {
  return {
    key,
    synthesize(request) {
      return attempt(() => {
        failIfAsked(key, request.segments.join(' '));
        const segmentStartsSeconds: number[] = [];
        let at = 0;
        for (const segment of request.segments) {
          segmentStartsSeconds.push(Number(at.toFixed(2)));
          at += segment.trim().split(/\s+/).length * SECONDS_PER_WORD + PAUSE_BETWEEN_SEGMENTS;
        }
        return {
          data: silentWav(at),
          mimeType: 'audio/wav',
          durationSeconds: Number(at.toFixed(2)),
          segmentStartsSeconds,
        };
      });
    },
  };
}

export function createFakeModeration(key = 'fake-moderation'): ModerationAdapter {
  return {
    key,
    checkText(text) {
      const marked = /FAKE_BLOCK:(\w+)/.exec(text)?.[1];
      if (!marked) return Promise.resolve({ allowed: true, flagged: [] });
      const category = MODERATION_CATEGORIES.find((c) => c === marked) ?? 'other';
      return Promise.resolve({ allowed: false, flagged: [{ category, score: 1 }] });
    },
    checkImage() {
      return Promise.resolve({ allowed: true, flagged: [] });
    },
  };
}

export function createFakePublisher(platform: TargetPlatform): Publisher {
  const key = `fake-${platform}`;
  return {
    platform,
    prepare(_account, content) {
      return attempt(() => {
        failIfAsked(key, content.text);
        return { platform, ref: `${key}-draft-${randomUUID()}` };
      });
    },
    check() {
      return Promise.resolve({ state: 'ready' as const });
    },
    publish(_account, prepared) {
      return Promise.resolve({ platformPostId: `${key}-post-${prepared.ref.slice(-12)}` });
    },
    // Only the fetch time: Insights must never show an invented number (plan section 15).
    metrics() {
      return Promise.resolve({ fetchedAt: new Date().toISOString() });
    },
  };
}
