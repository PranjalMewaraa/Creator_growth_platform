import type { Logger } from '@cgp/config';
import { jobsToRecover, ledgerDrift, type Database } from '@cgp/db';
import { enqueue, type Queues } from './queues';

export interface SweepResult {
  requeued: number;
  driftedWorkspaces: number;
}

/**
 * Runs when the worker starts (plan section 3: a sweep on boot stands in for a reconciler).
 * Postgres is the truth and Redis only transport (invariant 2), so every job whose time has
 * come, and every job a dead worker left running, is enqueued again. Enqueue dedupes on the
 * job id, so a job that is still in Redis is not duplicated.
 *
 * A job scheduled for later is not swept up: booting a worker must not fire next week's posts
 * (WP31). The dispatcher takes those when they are due.
 */
export async function sweepOnBoot(
  deps: { db: Database; queues: Queues; log: Logger },
  { staleAfterMs = 10 * 60_000 }: { staleAfterMs?: number } = {},
): Promise<SweepResult> {
  const stranded = await jobsToRecover(deps.db, {
    staleRunningBefore: new Date(Date.now() - staleAfterMs),
  });
  for (const job of stranded) await enqueue(deps.queues, job);

  const drift = await ledgerDrift(deps.db);
  if (drift.length > 0) {
    deps.log.error({ drift }, 'cached balance differs from the ledger sum');
  }

  deps.log.info({ requeued: stranded.length, drifted: drift.length }, 'boot sweep done');
  return { requeued: stranded.length, driftedWorkspaces: drift.length };
}
