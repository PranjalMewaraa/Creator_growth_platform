import type { TargetPlatform } from './generator';

/**
 * Status lives on each post target, never on the publication (plan section 14).
 *
 * - claimed: an attempt is in progress. The irreversible publish call is marked separately,
 *   so a crash before it is safe to retry and a crash after it is not.
 * - retry_scheduled, quota_wait, reauth_required, failed: the four failure categories.
 * - needs_verification: found claimed after the publish call with no post id (invariant 9).
 *   Never retried automatically.
 */
export const POST_TARGET_STATUSES = [
  'pending',
  'claimed',
  'published',
  'retry_scheduled',
  'quota_wait',
  'reauth_required',
  'failed',
  'needs_verification',
] as const;

export type PostTargetStatus = (typeof POST_TARGET_STATUSES)[number];

/**
 * Published platform limits on post text, in characters. They live here because the compiler,
 * the publishing checks and every length indicator in the UI have to agree on one number.
 */
export const PLATFORM_TEXT_LIMITS: Record<TargetPlatform, number> = {
  instagram: 2200,
  linkedin: 3000,
};

/** Published hashtag limits. LinkedIn publishes none, so nothing is enforced there. */
export const PLATFORM_HASHTAG_LIMITS: Partial<Record<TargetPlatform, number>> = {
  instagram: 30,
};

/** Hashtags as the platforms count them: `#` then letters, digits or underscores. */
export function countHashtags(text: string): number {
  return (text.match(/#[\p{L}\p{N}_]+/gu) ?? []).length;
}
