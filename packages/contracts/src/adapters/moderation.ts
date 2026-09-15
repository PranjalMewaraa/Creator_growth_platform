import type { MediaBytes } from '../media';

/** Provider categories map onto this set, so the user always sees the same names. */
export const MODERATION_CATEGORIES = [
  'sexual',
  'violence',
  'hate',
  'harassment',
  'self_harm',
  'dangerous',
  'illicit',
  'other',
] as const;

export type ModerationCategory = (typeof MODERATION_CATEGORIES)[number];

export interface ModerationVerdict {
  allowed: boolean;
  /** Categories that triggered, highest score first. Empty when allowed. */
  flagged: Array<{ category: ModerationCategory; score: number }>;
}

/**
 * Runs on the compiled prompt before dispatch (invariant 10), then on output. Video is
 * checked as sampled frames through `checkImage`.
 */
export interface ModerationAdapter {
  readonly key: string;
  checkText(text: string): Promise<ModerationVerdict>;
  checkImage(image: MediaBytes): Promise<ModerationVerdict>;
}
