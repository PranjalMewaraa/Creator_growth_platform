import type { JobHandler } from '@cgp/core';

/**
 * Generator handlers by generator key. Generator handlers are added in main.ts.
 * `noop` proves a queue is wired end to end: used locally and by the WP6 deploy check.
 */
export const handlers: Readonly<Record<string, JobHandler>> = {
  noop: (job, log) => {
    log.info({ jobId: job.id, jobClass: job.jobClass }, 'noop job processed');
    return Promise.resolve({
      actual: { credits: 0, videoSeconds: 0 },
      telemetry: { actionClass: 'noop', provider: 'none', realisedCostInr: 0 },
    });
  },
};
