import type { Logger } from '@cgp/config';
import { jobsToRecover, type Database } from '@cgp/db';
import { enqueue, type Queues } from './queues';

/**
 * The dispatcher (WP31). A scheduled post and a retry are both jobs sitting in Postgres with a
 * time on them; this is what notices the time has come and puts them on the queue.
 *
 * It polls rather than sleeping on a delayed queue, because Postgres is the truth and Redis
 * only transport (invariant 2). A delayed Redis job would be the only record of a schedule,
 * and losing Redis would silently lose every post waiting to go out. Polling a table that
 * already holds the schedule costs one indexed query a tick and cannot lose anything.
 *
 * The tick is fifteen seconds against a sixty second promise (plan section 5: scheduled posts
 * dispatch within 60 seconds of their time), which leaves room for a tick to be missed
 * entirely and the next one to still be in time.
 */
export const DISPATCH_EVERY_MS = 15_000;

export interface DispatchDeps {
  db: Database;
  queues: Queues;
  log: Logger;
}

/**
 * One pass: everything due now, and anything a dead worker left running. Enqueue dedupes on
 * the job id, so a job already in Redis is not queued twice and a tick that overlaps the
 * previous one is harmless.
 */
export async function dispatchDue(
  deps: DispatchDeps,
  { staleAfterMs = 10 * 60_000 }: { staleAfterMs?: number } = {},
): Promise<number> {
  const due = await jobsToRecover(deps.db, {
    staleRunningBefore: new Date(Date.now() - staleAfterMs),
  });
  for (const job of due) {
    await enqueue(deps.queues, job).catch((err: unknown) => {
      deps.log.error({ err, jobId: job.id }, 'dispatch could not enqueue; the next tick retries');
    });
  }
  return due.length;
}

/**
 * Runs the dispatcher until the returned function is called. One tick at a time: a slow pass
 * delays the next one rather than overlapping it, which keeps a struggling database from
 * being asked the same question by a growing pile of timers.
 */
export function startDispatcher(
  deps: DispatchDeps,
  { everyMs = DISPATCH_EVERY_MS }: { everyMs?: number } = {},
): () => void {
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;

  const tick = async () => {
    if (stopped) return;
    try {
      const dispatched = await dispatchDue(deps);
      if (dispatched > 0) deps.log.info({ dispatched }, 'dispatched due jobs');
    } catch (err) {
      deps.log.error({ err }, 'dispatch tick failed');
    }
    if (!stopped) timer = setTimeout(() => void tick(), everyMs);
  };

  timer = setTimeout(() => void tick(), everyMs);
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}
