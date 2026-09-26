import { describe, expect, it } from 'vitest';
import { backoffMs, MAX_PUBLISH_ATTEMPTS, nextAttemptAt } from './retry';

// No jitter, so a backoff is a number rather than a range.
const steady = () => 0.5;

describe('the publish backoff', () => {
  it('grows fourfold: half a minute, then two, eight and thirty-two', () => {
    const waits = [1, 2, 3, 4].map((attempt) => backoffMs(attempt, 'retriable', steady) / 1000);
    expect(waits).toEqual([30, 120, 480, 1920]);
  });

  it('makes a platform that says slow down wait a quarter of an hour, whichever attempt', () => {
    expect(backoffMs(1, 'quota', steady)).toBe(15 * 60_000);
    expect(backoffMs(4, 'quota', steady)).toBe(15 * 60_000);
  });

  it('never waits longer than an hour, however many attempts have gone by', () => {
    expect(backoffMs(99, 'retriable', steady)).toBe(60 * 60_000);
  });

  it('spreads the retries, so a hundred posts that failed together do not return together', () => {
    const earliest = backoffMs(1, 'retriable', () => 0);
    const latest = backoffMs(1, 'retriable', () => 1);
    expect(earliest).toBe(24_000);
    expect(latest).toBe(36_000);
  });
});

describe('when the next attempt is', () => {
  const now = new Date('2026-09-26T10:00:00.000Z');

  it('is the backoff after now', () => {
    const at = nextAttemptAt(0, 'retriable', { now, random: steady });
    expect(at?.toISOString()).toBe('2026-09-26T10:00:30.000Z');
  });

  it('gives up once the attempts are spent, so a dead platform is not hammered', () => {
    // Attempts already made, counting the one that just failed.
    expect(
      nextAttemptAt(MAX_PUBLISH_ATTEMPTS - 2, 'retriable', { now, random: steady }),
    ).toBeInstanceOf(Date);
    expect(
      nextAttemptAt(MAX_PUBLISH_ATTEMPTS - 1, 'retriable', { now, random: steady }),
    ).toBeUndefined();
  });
});
