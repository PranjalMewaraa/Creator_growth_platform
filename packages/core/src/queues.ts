import { JOB_CLASSES, type JobClass, type QueuedJobData } from '@cgp/contracts';
import type { JobRow } from '@cgp/db';
import { Queue } from 'bullmq';
import type { Redis } from 'ioredis';

/** One queue per job class (invariant 5); the queue name is the class. */
export type Queues = Record<JobClass, Queue<QueuedJobData>>;

export interface QueueOptions {
  /** Namespaces every key, so tests never share queues with a running worker. */
  prefix?: string;
}

export function createQueues(connection: Redis, { prefix }: QueueOptions = {}): Queues {
  return Object.fromEntries(
    JOB_CLASSES.map((jobClass) => [
      jobClass,
      new Queue<QueuedJobData>(jobClass, {
        connection,
        ...(prefix ? { prefix } : {}),
        // Upstash answers INFO with NOPERM; this is BullMQ's own version-detection call,
        // separate from ioredis's ready check (which createRedis already turns off).
        skipVersionCheck: true,
      }),
    ]),
  ) as Queues;
}

export async function closeQueues(queues: Queues): Promise<void> {
  await Promise.all(Object.values(queues).map((queue) => queue.close()));
}

/**
 * Redis carries only the job id (invariant 2); Postgres holds the job. The job id is the
 * BullMQ id, so enqueuing the same job twice adds it once. Finished jobs are removed from
 * Redis, which lets the sweep re-enqueue a job whose earlier copy was lost.
 */
export async function enqueue(
  queues: Queues,
  job: Pick<JobRow, 'id' | 'jobClass' | 'generatorKey' | 'correlationId'>,
): Promise<void> {
  await queues[job.jobClass].add(
    job.generatorKey,
    { jobId: job.id, correlationId: job.correlationId ?? job.id },
    { jobId: job.id, removeOnComplete: true, removeOnFail: { count: 1000 } },
  );
}
