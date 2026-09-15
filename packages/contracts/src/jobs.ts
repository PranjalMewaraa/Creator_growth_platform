/**
 * Invariant 5: render, inference and publishing are separate job classes, even while
 * one worker process runs all three. Each class has its own queue, so splitting them
 * onto separate machines later is a deployment change.
 */
export const JOB_CLASSES = ['inference', 'render', 'publish'] as const;

export type JobClass = (typeof JOB_CLASSES)[number];

/** Payload every queued job carries. Postgres holds the job itself; Redis only carries its id. */
export interface QueuedJobData {
  jobId: string;
  correlationId: string;
}

export const JOB_STATUSES = [
  'QUEUED',
  'RUNNING',
  'MODERATING',
  'COMPLETE',
  'BLOCKED',
  'FAILED',
  'CANCELLED',
] as const;

export type JobStatus = (typeof JOB_STATUSES)[number];

/**
 * What happens to held credits when a job reaches each status (plan section 14).
 * Null while the hold stands. There is no partial charge: a job settles or refunds in full.
 */
export function settlementFor(status: JobStatus): 'settle' | 'refund' | null {
  switch (status) {
    case 'COMPLETE':
      return 'settle';
    case 'BLOCKED':
    case 'FAILED':
    case 'CANCELLED':
      return 'refund';
    case 'QUEUED':
    case 'RUNNING':
    case 'MODERATING':
      return null;
  }
}
