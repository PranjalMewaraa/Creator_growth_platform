import type { AspectRatio, MediaBytes } from '../media';

export interface ImageRequest {
  /** Never asks for rendered headline text: text is composited as a vector layer (invariant 12). */
  prompt: string;
  negativePrompt?: string;
  /** Derived from the target platform, never asked of the user. */
  aspectRatio: AspectRatio;
  count: number;
  seed?: number;
  signal?: AbortSignal;
}

export type GeneratedImage = MediaBytes & { width: number; height: number };

export interface ImageResult {
  images: GeneratedImage[];
}

export interface ImageAdapter {
  readonly key: string;
  generate(request: ImageRequest): Promise<ImageResult>;
}
