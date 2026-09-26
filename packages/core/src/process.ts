import type { Logger } from '@cgp/config';
import type { QueuedJobData } from '@cgp/contracts';
import {
  markJobRunning,
  refundJob,
  rescheduleJob,
  settleJob,
  type Amounts,
  type CostTelemetry,
  type Database,
  type JobRow,
} from '@cgp/db';

/** What a generator reports when its work succeeds. Telemetry is required on every job. */
export interface JobOutcome {
  actual: Amounts;
  telemetry: CostTelemetry;
}

export type JobHandler = (job: JobRow, log: Logger) => Promise<JobOutcome>;

/**
 * Thrown by a handler that has not finished but should be tried again (WP31). The job goes
 * back to QUEUED with its time set, and the hold stays where it is: nothing was delivered, so
 * there is nothing to settle, and the work is still coming, so there is nothing to refund.
 */
export class JobRetry extends Error {
  override readonly name = 'JobRetry';
  constructor(
    readonly runAt: Date,
    message = `Retrying at ${runAt.toISOString()}`,
  ) {
    super(message);
  }
}

/** Thrown by a handler when moderation stops the output. The job is refunded as BLOCKED. */
export class JobBlocked extends Error {
  override readonly name = 'JobBlocked';
  constructor(
    readonly category: string,
    message = `Blocked by moderation: ${category}`,
  ) {
    super(message);
  }
}

export interface ProcessDeps {
  db: Database;
  handlers: Readonly<Record<string, JobHandler>>;
  log: Logger;
}

export type ProcessResult = 'settled' | 'refunded' | 'skipped' | 'retrying';

/**
 * Runs one queued job to its end. The charge already happened as a hold when the job was
 * created; here the worker only settles the actual cost or refunds in full (invariant 7).
 * A job that has already ended is skipped, so a duplicate delivery changes nothing.
 */
export async function processJob(deps: ProcessDeps, data: QueuedJobData): Promise<ProcessResult> {
  const job = await markJobRunning(deps.db, data.jobId);
  if (!job) return 'skipped';

  const handler = deps.handlers[job.generatorKey];
  if (!handler) {
    await refundJob(deps.db, job.id, 'FAILED', {
      code: 'UNKNOWN_GENERATOR',
      message: `No handler for generator "${job.generatorKey}"`,
    });
    return 'refunded';
  }

  let outcome: JobOutcome;
  try {
    outcome = await handler(job, deps.log);
  } catch (err) {
    if (err instanceof JobRetry) {
      const rescheduled = await rescheduleJob(deps.db, job.id, err.runAt);
      deps.log.info(
        { jobId: job.id, runAt: err.runAt, attempts: rescheduled?.attemptCount },
        'job will be tried again',
      );
      return 'retrying';
    }
    const blocked = err instanceof JobBlocked;
    // A check that could not run is a failure, not a block: nothing was found, and nothing
    // was released either. Both refund in full.
    const unavailable = err instanceof Error && err.name === 'ModerationUnavailable';
    await refundJob(deps.db, job.id, blocked ? 'BLOCKED' : 'FAILED', {
      code: blocked
        ? 'MODERATION_BLOCKED'
        : unavailable
          ? 'MODERATION_UNAVAILABLE'
          : 'GENERATION_FAILED',
      message: err instanceof Error ? err.message : String(err),
      ...(blocked ? { category: err.category } : {}),
    });
    deps.log.warn(
      { err, jobId: job.id },
      blocked ? 'job blocked, refunded' : 'job failed, refunded',
    );
    return 'refunded';
  }

  await settleJob(deps.db, job.id, outcome.actual, outcome.telemetry);
  return 'settled';
}
