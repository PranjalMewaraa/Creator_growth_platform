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

/** Statuses a job never leaves. */
export function isTerminalStatus(status: JobStatus): boolean {
  return settlementFor(status) !== null;
}

/** What the API shows about a job. Postgres is the source; nothing here comes from Redis. */
export interface JobView {
  id: string;
  generatorKey: string;
  jobClass: JobClass;
  status: JobStatus;
  held: { credits: number; videoSeconds: number };
  /** Null until the job settles. */
  settled: { credits: number; videoSeconds: number } | null;
  /** On BLOCKED, `category` is the moderation category shown to the user. */
  error: { code: string; message: string; category?: string } | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Events on a job's stream (D9). `status` comes from Postgres. `delta` is streamed text relayed
 * through Redis pub/sub: best effort, so a client that joins late misses earlier deltas and
 * reads the finished output instead.
 *
 * The server ends the stream after a terminal status, but EventSource reconnects whenever a
 * stream ends, so the client closes it on the first terminal status it sees.
 */
export type JobEvent = { type: 'status'; job: JobView } | { type: 'delta'; text: string };
