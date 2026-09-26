import type { PostTargetStatus } from '@cgp/contracts';

/**
 * How a post target reads to a person, in one place, so the composer and the calendar never
 * describe the same status with different words (WP34).
 */

/** Statuses the worker is still working through. */
export const IN_FLIGHT: ReadonlySet<PostTargetStatus> = new Set(['pending', 'claimed']);

/** Ended this attempt, but the worker is bringing it back on its own (WP31). */
export const COMING_BACK: ReadonlySet<PostTargetStatus> = new Set([
  'retry_scheduled',
  'quota_wait',
]);

/** Waiting for a person: nothing will move these on its own. */
export const NEEDS_YOU: ReadonlySet<PostTargetStatus> = new Set([
  'reauth_required',
  'needs_verification',
  'failed',
]);

export const STATUS_TEXT: Record<PostTargetStatus, string> = {
  pending: 'Waiting',
  claimed: 'Publishing',
  published: 'Published',
  retry_scheduled: 'Trying again shortly',
  quota_wait: 'Platform limit reached, waiting',
  reauth_required: 'Reconnect the account',
  failed: 'Failed',
  needs_verification: 'Check the account',
};

/** The same thing in the space a calendar card has. */
export const STATUS_SHORT: Record<PostTargetStatus, string> = {
  pending: 'Scheduled',
  claimed: 'Posting',
  published: 'Published',
  retry_scheduled: 'Retrying',
  quota_wait: 'Limited',
  reauth_required: 'Reconnect',
  failed: 'Failed',
  needs_verification: 'Check',
};

export const STATUS_TONE: Record<PostTargetStatus, string> = {
  pending: 'text-muted border-line',
  claimed: 'text-accent border-accent/50',
  published: 'text-good border-good/50',
  retry_scheduled: 'text-hot border-hot/50',
  quota_wait: 'text-hot border-hot/50',
  reauth_required: 'text-bad border-bad/50',
  failed: 'text-bad border-bad/50',
  needs_verification: 'text-hot border-hot/50',
};
