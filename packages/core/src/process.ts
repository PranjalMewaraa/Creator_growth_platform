import type { Logger } from '@cgp/config';
import type { QueuedJobData } from '@cgp/contracts';
import {
  markJobRunning,
  refundJob,
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

export type ProcessResult = 'settled' | 'refunded' | 'skipped';

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
    const blocked = err instanceof JobBlocked;
    await refundJob(deps.db, job.id, blocked ? 'BLOCKED' : 'FAILED', {
      code: blocked ? 'MODERATION_BLOCKED' : 'GENERATION_FAILED',
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
