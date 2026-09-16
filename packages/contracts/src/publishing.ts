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
