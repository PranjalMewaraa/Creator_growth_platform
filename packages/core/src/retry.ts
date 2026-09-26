import type { FailureCategory } from '@cgp/contracts';

/**
 * When to try again (WP31, plan section 14: "exponential backoff, bounded attempts, notify
 * only when exhausted").
 *
 * Two of the four failure categories come back here. `retriable` is a wobble — a timeout, a
 * 5xx, a connection dropped — and it is worth trying again soon. `quota` is the platform
 * saying not now, and trying again soon is how an app gets rate limited harder, so it waits
 * much longer and spends its attempts more slowly. `reauth` and `terminal` never reach this
 * file: one needs a person to reconnect the account, the other is a refusal that retrying
 * would only repeat, and repeating a policy rejection risks the app being suspended.
 */

/** Attempts in total, not retries after the first. Four retries over roughly forty minutes. */
export const MAX_PUBLISH_ATTEMPTS = 5;

/** 30 seconds, then two, eight and thirty-two minutes. */
const RETRIABLE_BASE_MS = 30_000;
const RETRIABLE_FACTOR = 4;

/** A platform that says "slow down" is not asked again for a quarter of an hour. */
const QUOTA_WAIT_MS = 15 * 60_000;

/** Nothing waits longer than this, however many attempts have gone by. */
const MAX_WAIT_MS = 60 * 60_000;

/**
 * How long to wait before attempt number `attempt` (1 is the first retry). Jittered by up to
 * a fifth either way, so a platform that failed a hundred posts at once does not get all
 * hundred back in the same second.
 */
export function backoffMs(
  attempt: number,
  category: Extract<FailureCategory, 'retriable' | 'quota'>,
  random: () => number = Math.random,
): number {
  const base =
    category === 'quota'
      ? QUOTA_WAIT_MS
      : RETRIABLE_BASE_MS * RETRIABLE_FACTOR ** Math.max(0, attempt - 1);
  const jitter = 1 + (random() * 2 - 1) * 0.2;
  return Math.round(Math.min(base, MAX_WAIT_MS) * jitter);
}

/** When the next attempt is due, or undefined when the attempts are spent. */
export function nextAttemptAt(
  attemptsMade: number,
  category: Extract<FailureCategory, 'retriable' | 'quota'>,
  { now = new Date(), random = Math.random }: { now?: Date; random?: () => number } = {},
): Date | undefined {
  if (attemptsMade >= MAX_PUBLISH_ATTEMPTS - 1) return undefined;
  return new Date(now.getTime() + backoffMs(attemptsMade + 1, category, random));
}
