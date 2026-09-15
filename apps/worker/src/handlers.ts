import type { JobClass, QueuedJobData } from '@cgp/contracts';
import type { Logger } from '@cgp/config';
import type { Job } from 'bullmq';

export type Handler = (job: Job<QueuedJobData>, log: Logger) => Promise<unknown>;

/** Proves a class's queue is wired end to end. Used locally and by the WP6 deploy check. */
const noop: Handler = (job, log) => {
  log.info({ jobId: job.data.jobId }, 'noop job processed');
  return Promise.resolve({ ok: true });
};

/** Handlers by job class, then by job name. */
export const handlers: Record<JobClass, Record<string, Handler>> = {
  inference: { noop },
  render: { noop },
  publish: { noop },
};
