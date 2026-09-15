/** Aspect ratios the target platforms use. Adapters deliver exactly the ratio requested. */
export type AspectRatio = '1:1' | '4:5' | '9:16' | '16:9';

export interface MediaBytes {
  data: Uint8Array;
  mimeType: string;
}

/** English only for the demo. Adding a language is a routing and config change (plan section 3). */
export const LANGUAGES = ['en'] as const;

export type LanguageCode = (typeof LANGUAGES)[number];
