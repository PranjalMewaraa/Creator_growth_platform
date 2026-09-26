import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  createdAt,
  currencyEnum,
  id,
  jobClassEnum,
  jobStatusEnum,
  ledgerReasonEnum,
  updatedAt,
} from './columns';
import { workspaceId } from './tenancy';

export const jobs = pgTable(
  'jobs',
  {
    id: id(),
    workspaceId: workspaceId(),
    jobClass: jobClassEnum('job_class').notNull(),
    generatorKey: text('generator_key').notNull(),
    status: jobStatusEnum('status').notNull().default('QUEUED'),
    creditsHeld: integer('credits_held').notNull().default(0),
    creditsSettled: integer('credits_settled'),
    videoSecondsHeld: integer('video_seconds_held').notNull().default(0),
    videoSecondsSettled: integer('video_seconds_settled'),
    input: jsonb('input')
      .notNull()
      .default(sql`'{}'::jsonb`),
    error: jsonb('error'),
    /** Carried so a job re-enqueued by the sweep keeps its original correlation id. */
    correlationId: text('correlation_id'),
    /**
     * Not before this time (WP31). Now for everything that runs at once; the scheduled time
     * for a post waiting for its slot, and the next attempt for one backing off. The schedule
     * lives here rather than in Redis because Postgres is the truth (invariant 2): a flushed
     * Redis loses nothing, and the dispatcher finds the job again.
     */
    runAt: timestamp('run_at', { withTimezone: true }).notNull().defaultNow(),
    /** Attempts made. Bounds the retries, so a failing platform is not hammered forever. */
    attemptCount: integer('attempt_count').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('jobs_workspace_created').on(t.workspaceId, t.createdAt),
    index('jobs_status').on(t.status),
    // What the dispatcher asks for every tick: what is waiting, and is it due yet.
    index('jobs_due').on(t.status, t.runAt),
    check('jobs_holds_non_negative', sql`${t.creditsHeld} >= 0 AND ${t.videoSecondsHeld} >= 0`),
  ],
);

/**
 * Append only (invariant 6): a trigger in the migrations rejects UPDATE and DELETE.
 * Balance is SUM(delta) per workspace and currency.
 */
export const creditLedger = pgTable(
  'credit_ledger',
  {
    id: id(),
    workspaceId: workspaceId(),
    jobId: uuid('job_id').references(() => jobs.id),
    currency: currencyEnum('currency').notNull(),
    delta: integer('delta').notNull(),
    reason: ledgerReasonEnum('reason').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    // A retried hold, settle or refund for the same job is rejected (A3).
    uniqueIndex('credit_ledger_once_per_job')
      .on(t.jobId, t.currency, t.reason)
      .where(sql`reason <> 'grant'`),
    index('credit_ledger_workspace_currency').on(t.workspaceId, t.currency),
    check('credit_ledger_job_required', sql`reason = 'grant' OR job_id IS NOT NULL`),
    // Settle writes +(held - actual), so it is never negative: no charge above the hold.
    check(
      'credit_ledger_delta_sign',
      sql`CASE reason WHEN 'hold' THEN delta < 0 WHEN 'settle' THEN delta >= 0 ELSE delta > 0 END`,
    ),
  ],
);

/** Written on every job completion. Painful to backfill (plan section 18). */
export const costTelemetry = pgTable(
  'cost_telemetry',
  {
    id: id(),
    workspaceId: workspaceId(),
    jobId: uuid('job_id')
      .notNull()
      .references(() => jobs.id),
    actionClass: text('action_class').notNull(),
    provider: text('provider').notNull(),
    realisedCostInr: numeric('realised_cost_inr', { precision: 12, scale: 4 }).notNull(),
    tokensIn: integer('tokens_in'),
    tokensOut: integer('tokens_out'),
    createdAt: createdAt(),
  },
  (t) => [index('cost_telemetry_job').on(t.jobId)],
);
