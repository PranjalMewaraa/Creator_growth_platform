/**
 * A rolling window rate limit (WP40).
 *
 * Vertex allows two image generations a minute for this project, per base model, on the
 * global endpoint — `GenContentImageGenRequestsPerMinutePerProjectPerBaseModelGlobal`, fixed,
 * and not eligible for an increase. A three frame storyboard fires three calls in a few
 * seconds and the third is always refused, which is what every image failure this week turned
 * out to be.
 *
 * A rolling window rather than fixed spacing: the first two calls go at once, as the quota
 * allows, and only the third waits for the first to age out. Fixed spacing would make every
 * storyboard slow to protect against a limit the first two calls never reach.
 *
 * This counts what this process has sent. A second process has its own count, so the real
 * ceiling is the sum, and a 429 can still arrive; that is what the retry is for.
 */

export interface Pacer {
  /** Runs the call when the window has room, retrying once the quota refuses it. */
  run<T>(call: () => Promise<T>): Promise<T>;
}

export interface PacerOptions {
  perMinute: number;
  /** How many times a refusal is waited out before it is given up on. */
  retries?: number;
  /** Whether an error is the quota saying no, rather than something to fail on. */
  isQuotaError?: (err: unknown) => boolean;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

const WINDOW_MS = 60_000;

export function createPacer({
  perMinute,
  retries = 3,
  isQuotaError = () => false,
  now = Date.now,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}: PacerOptions): Pacer {
  if (perMinute <= 0) throw new Error('A pacer needs a positive rate');
  const sent: number[] = [];
  // One queue, not many: two calls that both find room would both take the same slot.
  let turn = Promise.resolve();

  async function waitForRoom(): Promise<void> {
    for (;;) {
      const cutoff = now() - WINDOW_MS;
      while (sent.length > 0 && (sent[0] ?? 0) <= cutoff) sent.shift();
      if (sent.length < perMinute) {
        sent.push(now());
        return;
      }
      // The oldest call in the window decides when there is room again.
      const oldest = sent[0] ?? now();
      await sleep(Math.max(0, oldest + WINDOW_MS - now()) + 250);
    }
  }

  return {
    run<T>(call: () => Promise<T>): Promise<T> {
      const mine = turn.then(async () => {
        for (let attempt = 0; ; attempt++) {
          await waitForRoom();
          try {
            return await call();
          } catch (err) {
            if (attempt >= retries || !isQuotaError(err)) throw err;
            // Another process spent the window. Wait a whole one rather than guessing.
            await sleep(WINDOW_MS / perMinute + 250);
          }
        }
      });
      // The next caller queues behind this one whether it worked or not.
      turn = mine.then(
        () => undefined,
        () => undefined,
      );
      return mine;
    },
  };
}
