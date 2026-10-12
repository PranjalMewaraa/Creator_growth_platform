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
/**
 * One step of work, as it happens (WP44). Three of this product's operations take between
 * eighty seconds and four minutes, and the screen used to say nothing for all of it. These are
 * the stages the worker already logs, sent to the browser instead of only to a log file.
 */
export interface JobStage {
  /** Stable per stage, so a repeat updates the line rather than adding another. */
  key: string;
  /** What is happening, in the words a creator reads. */
  label: string;
  status: 'working' | 'waiting' | 'done' | 'failed';
  /** For work with countable parts: frame 2 of 3. */
  index?: number;
  total?: number;
  /** Why this is taking the time it is. Shown only when there is an honest reason. */
  note?: string;
  /** Something this stage produced, such as a frame that can be looked at already. */
  url?: string;
  /** How long it took, once it is done. */
  seconds?: number;
}

export type JobEvent =
  | { type: 'status'; job: JobView }
  | { type: 'delta'; text: string }
  | { type: 'stage'; stage: JobStage };
