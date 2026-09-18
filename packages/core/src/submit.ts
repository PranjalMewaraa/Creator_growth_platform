import type { CreditEstimate, JobClass } from '@cgp/contracts';
import type { Logger } from '@cgp/config';
import { createJobWithHold, type CreateJobResult, type Database } from '@cgp/db';
import { enqueue, type Queues } from './queues';

export interface SubmitDeps {
  db: Database;
  queues: Queues;
  log: Logger;
}

export interface JobRequest {
  workspaceId: string;
  jobClass: JobClass;
  generatorKey: string;
  input?: unknown;
  estimate: CreditEstimate;
  correlationId?: string;
  compiledPromptId?: string;
}

/**
 * Invariant 7: hold and job commit together, and only then is the job enqueued. If the enqueue
 * fails the job is already safe in Postgres as QUEUED, and the boot sweep will enqueue it.
 */
export async function submitJob(deps: SubmitDeps, request: JobRequest): Promise<CreateJobResult> {
  const result = await createJobWithHold(deps.db, {
    workspaceId: request.workspaceId,
    jobClass: request.jobClass,
    generatorKey: request.generatorKey,
    input: request.input,
    correlationId: request.correlationId,
    compiledPromptId: request.compiledPromptId,
    hold: { credits: request.estimate.credits, videoSeconds: request.estimate.videoSeconds ?? 0 },
  });
  if (!result.ok) return result;

  try {
    await enqueue(deps.queues, result.job);
  } catch (err) {
    deps.log.error(
      { err, jobId: result.job.id },
      'enqueue failed; the boot sweep will recover the job',
    );
  }
  return result;
}
