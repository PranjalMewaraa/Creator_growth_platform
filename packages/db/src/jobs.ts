import { settlementFor, type Currency, type JobClass } from '@cgp/contracts';
import { and, eq, inArray, lt, or, sql } from 'drizzle-orm';
import { unwrap, type Database } from './client';
import { applyLedgerEntry } from './ledger';
import { costTelemetry, creditLedger, jobs, workspaces } from './schema';

export type JobRow = typeof jobs.$inferSelect;

/** Whole credits and whole video seconds, never negative. */
export interface Amounts {
  credits: number;
  videoSeconds: number;
}

export interface NewJob {
  workspaceId: string;
  jobClass: JobClass;
  generatorKey: string;
  input?: unknown;
  correlationId?: string;
  /** From the generator's estimate. Held now, settled or refunded when the job ends. */
  hold: Amounts;
}

export type CreateJobResult =
  | { ok: true; job: JobRow }
  | {
      ok: false;
      reason: 'workspace_not_found' | 'insufficient_credits' | 'insufficient_video_seconds';
    };

export interface CostTelemetry {
  actionClass: string;
  provider: string;
  realisedCostInr: number;
  tokensIn?: number;
  tokensOut?: number;
}

const CURRENCIES: Array<[Currency, keyof Amounts, 'creditsHeld' | 'videoSecondsHeld']> = [
  ['credits', 'credits', 'creditsHeld'],
  ['video_seconds', 'videoSeconds', 'videoSecondsHeld'],
];

function checkAmounts(amounts: Amounts, what: string) {
  for (const [, key] of CURRENCIES) {
    if (!Number.isInteger(amounts[key]) || amounts[key] < 0) {
      throw new Error(`${what} ${key} must be a whole number of at least 0, got ${amounts[key]}`);
    }
  }
}

/**
 * Invariant 7: the hold commits in the same transaction that creates the job, and nothing is
 * created when the balance cannot cover it. The caller enqueues only after this resolves.
 * The job row is inserted before its ledger rows so the ledger's foreign key holds (A10).
 */
export async function createJobWithHold(db: Database, job: NewJob): Promise<CreateJobResult> {
  checkAmounts(job.hold, 'Hold');
  return unwrap(db).transaction(async (tx): Promise<CreateJobResult> => {
    const [balance] = await tx
      .select({ credits: workspaces.creditBalance, videoSeconds: workspaces.videoSecondsBalance })
      .from(workspaces)
      .where(eq(workspaces.id, job.workspaceId))
      .for('update');
    if (!balance) return { ok: false, reason: 'workspace_not_found' };
    if (balance.credits < job.hold.credits) return { ok: false, reason: 'insufficient_credits' };
    if (balance.videoSeconds < job.hold.videoSeconds) {
      return { ok: false, reason: 'insufficient_video_seconds' };
    }

    const [created] = await tx
      .insert(jobs)
      .values({
        workspaceId: job.workspaceId,
        jobClass: job.jobClass,
        generatorKey: job.generatorKey,
        input: job.input ?? {},
        correlationId: job.correlationId,
        creditsHeld: job.hold.credits,
        videoSecondsHeld: job.hold.videoSeconds,
      })
      .returning();
    if (!created) throw new Error('Job insert returned no row');

    for (const [currency, key] of CURRENCIES) {
      if (job.hold[key] === 0) continue;
      await applyLedgerEntry(tx, {
        workspaceId: job.workspaceId,
        jobId: created.id,
        currency,
        delta: -job.hold[key],
        reason: 'hold',
      });
    }
    return { ok: true, job: created };
  });
}

/**
 * Moves a job to RUNNING when a worker picks it up. Also accepts a job already RUNNING, which
 * is what a job re-enqueued after a crash looks like. Returns undefined for a job that has
 * already ended, so a duplicate delivery does nothing.
 */
export async function markJobRunning(db: Database, jobId: string): Promise<JobRow | undefined> {
  const [row] = await unwrap(db)
    .update(jobs)
    .set({ status: 'RUNNING' })
    .where(and(eq(jobs.id, jobId), inArray(jobs.status, ['QUEUED', 'RUNNING', 'MODERATING'])))
    .returning();
  return row;
}

export type EndJobResult = { applied: true; job: JobRow } | { applied: false; job: JobRow };

/**
 * Charges the actual cost and releases the rest of the hold: the settle entry is
 * +(held - actual), so the net charge is the actual cost and never more than the hold.
 * A job that has already ended is left alone, so a retried settle is a no-op; the ledger's
 * unique index backs that up. The cost telemetry row lands in the same transaction.
 */
export async function settleJob(
  db: Database,
  jobId: string,
  actual: Amounts,
  telemetry: CostTelemetry,
): Promise<EndJobResult> {
  checkAmounts(actual, 'Actual');
  return unwrap(db).transaction(async (tx): Promise<EndJobResult> => {
    const [job] = await tx.select().from(jobs).where(eq(jobs.id, jobId)).for('update');
    if (!job) throw new Error(`Job ${jobId} not found`);
    if (settlementFor(job.status) !== null) return { applied: false, job };

    for (const [currency, key, held] of CURRENCIES) {
      if (actual[key] > job[held]) {
        throw new Error(`Actual ${key} ${actual[key]} exceeds the hold of ${job[held]}`);
      }
      if (job[held] === 0) continue;
      await applyLedgerEntry(tx, {
        workspaceId: job.workspaceId,
        jobId,
        currency,
        delta: job[held] - actual[key],
        reason: 'settle',
      });
    }

    await tx.insert(costTelemetry).values({
      workspaceId: job.workspaceId,
      jobId,
      actionClass: telemetry.actionClass,
      provider: telemetry.provider,
      realisedCostInr: telemetry.realisedCostInr.toFixed(4),
      tokensIn: telemetry.tokensIn,
      tokensOut: telemetry.tokensOut,
    });

    const [updated] = await tx
      .update(jobs)
      .set({
        status: 'COMPLETE',
        creditsSettled: actual.credits,
        videoSecondsSettled: actual.videoSeconds,
      })
      .where(eq(jobs.id, jobId))
      .returning();
    return { applied: true, job: updated ?? job };
  });
}

/** Refunds the whole hold (plan section 14). Idempotent in the same way as settleJob. */
export function refundJob(
  db: Database,
  jobId: string,
  status: 'FAILED' | 'BLOCKED' | 'CANCELLED',
  error?: { code: string; message: string; category?: string },
): Promise<EndJobResult> {
  return unwrap(db).transaction(async (tx): Promise<EndJobResult> => {
    const [job] = await tx.select().from(jobs).where(eq(jobs.id, jobId)).for('update');
    if (!job) throw new Error(`Job ${jobId} not found`);
    if (settlementFor(job.status) !== null) return { applied: false, job };

    for (const [currency, , held] of CURRENCIES) {
      if (job[held] === 0) continue;
      await applyLedgerEntry(tx, {
        workspaceId: job.workspaceId,
        jobId,
        currency,
        delta: job[held],
        reason: 'refund',
      });
    }

    const [updated] = await tx
      .update(jobs)
      .set({ status, error: error ?? null })
      .where(eq(jobs.id, jobId))
      .returning();
    return { applied: true, job: updated ?? job };
  });
}

/**
 * For the boot sweep (invariant 2): jobs still waiting, and jobs a dead worker left running.
 * Scoped by status rather than workspace because the sweep serves every workspace.
 */
export function jobsToRecover(
  db: Database,
  { staleRunningBefore }: { staleRunningBefore: Date },
): Promise<JobRow[]> {
  return unwrap(db)
    .select()
    .from(jobs)
    .where(
      or(
        eq(jobs.status, 'QUEUED'),
        and(
          inArray(jobs.status, ['RUNNING', 'MODERATING']),
          lt(jobs.updatedAt, staleRunningBefore),
        ),
      ),
    );
}

export interface BalanceDrift {
  workspaceId: string;
  cached: Amounts;
  ledger: Amounts;
}

/** Workspaces whose cached balance differs from the ledger sum. Should always be empty. */
export async function ledgerDrift(db: Database): Promise<BalanceDrift[]> {
  const sums = unwrap(db)
    .select({
      workspaceId: creditLedger.workspaceId,
      credits:
        sql<number>`coalesce(sum(${creditLedger.delta}) filter (where ${creditLedger.currency} = 'credits'), 0)::int`.as(
          'credits',
        ),
      videoSeconds:
        sql<number>`coalesce(sum(${creditLedger.delta}) filter (where ${creditLedger.currency} = 'video_seconds'), 0)::int`.as(
          'video_seconds',
        ),
    })
    .from(creditLedger)
    .groupBy(creditLedger.workspaceId)
    .as('sums');

  const rows = await unwrap(db)
    .select({
      workspaceId: workspaces.id,
      cachedCredits: workspaces.creditBalance,
      cachedVideoSeconds: workspaces.videoSecondsBalance,
      ledgerCredits: sql<number>`coalesce(${sums.credits}, 0)`,
      ledgerVideoSeconds: sql<number>`coalesce(${sums.videoSeconds}, 0)`,
    })
    .from(workspaces)
    .leftJoin(sums, eq(sums.workspaceId, workspaces.id));

  return rows
    .map((r) => ({
      workspaceId: r.workspaceId,
      cached: { credits: r.cachedCredits, videoSeconds: r.cachedVideoSeconds },
      ledger: { credits: Number(r.ledgerCredits), videoSeconds: Number(r.ledgerVideoSeconds) },
    }))
    .filter(
      (r) =>
        r.cached.credits !== r.ledger.credits || r.cached.videoSeconds !== r.ledger.videoSeconds,
    );
}
