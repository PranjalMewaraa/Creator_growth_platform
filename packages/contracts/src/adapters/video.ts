import type { NormalizedError } from '../errors';
import type { MediaBytes } from '../media';

export interface VideoRequest {
  prompt: string;
  negativePrompt?: string;
  aspectRatio: '9:16' | '16:9';
  durationSeconds: number;
  resolution: '720p' | '1080p';
  seed?: number;
}

export type GeneratedClip = MediaBytes & { durationSeconds: number; width: number; height: number };

/**
 * `failed` is the provider rejecting the operation, such as a content filter. A failed call
 * to poll itself, such as a network error, throws AdapterError instead.
 */
export type VideoPollResult =
  | { status: 'running' }
  | { status: 'done'; clip: GeneratedClip }
  | { status: 'failed'; error: NormalizedError };

/**
 * Video generation is a long running operation: submit once, then poll. Two providers sit
 * behind this interface, one live and one stubbed (FR-VD-17).
 */
export interface VideoAdapter {
  readonly key: string;
  submit(request: VideoRequest): Promise<{ operationId: string }>;
  poll(operationId: string): Promise<VideoPollResult>;
}
