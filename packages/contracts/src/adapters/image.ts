import type { AspectRatio, MediaBytes } from '../media';
import type { TokenUsage } from './text';

export interface ImageRequest {
  /** Never asks for rendered headline text: text is composited as a vector layer (invariant 12). */
  prompt: string;
  /** Derived from the target platform, never asked of the user. */
  aspectRatio: AspectRatio;
  count: number;
  /**
   * Pictures the model should stay consistent with (WP39). A reel whose scenes were drawn
   * independently looks like three different kitchens; drawing the later frames while looking
   * at the first one is what keeps the same hand, the same counter, the same light.
   *
   * Only models whose capability says `acceptsReferenceImages` are given any.
   */
  references?: readonly MediaBytes[];
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
