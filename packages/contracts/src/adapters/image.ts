import type { AspectRatio, MediaBytes } from '../media';
import type { TokenUsage } from './text';

export interface ImageRequest {
  /** Never asks for rendered headline text: text is composited as a vector layer (invariant 12). */
  prompt: string;
  /** Derived from the target platform, never asked of the user. */
  aspectRatio: AspectRatio;
  count: number;
  seed?: number;
  signal?: AbortSignal;
}

export type GeneratedImage = MediaBytes & { width: number; height: number };

export interface ImageResult {
  images: GeneratedImage[];
  /**
   * Image models bill the picture itself as output tokens, so cost telemetry reads the same
   * shape as text. Zero for fakes.
   */
  usage: TokenUsage;
}

export interface ImageAdapter {
  readonly key: string;
  generate(request: ImageRequest): Promise<ImageResult>;
}
