import { JOB_CLASSES, type JobClass, type QueuedJobData } from '@cgp/contracts';
import {
  baseEnvSchema,
  createLogger,
  loadRootEnvFile,
  parseEnv,
  withCorrelation,
} from '@cgp/config';
import { closeQueues, createQueues, processJob, sweepOnBoot } from '@cgp/core';
import { createDatabase } from '@cgp/db';
import { Worker } from 'bullmq';
import { createErrorThrottle } from './error-throttle';
import { handlers } from './handlers';
import { createRedis, waitForRedis } from './redis';

loadRootEnvFile();
const env = parseEnv(baseEnvSchema);
const log = createLogger({ service: 'worker', level: env.LOG_LEVEL });
const reportError = createErrorThrottle(log);

const db = createDatabase(env.DATABASE_URL);
const connection = createRedis(env.REDIS_URL);
connection.on('error', (err) => reportError('redis', err));
if (connection.status !== 'ready') {
  log.info('waiting for Redis');
  await waitForRedis(connection);
}

// Postgres holds the truth (invariant 2): before taking new work, re-enqueue whatever a
// previous process left waiting or running.
const queues = createQueues(connection);
await sweepOnBoot({ db, queues, log });

// Render runs ffmpeg on a small box, so it gets one slot. Inference is mostly waiting on providers.
const CONCURRENCY: Record<JobClass, number> = { inference: 8, render: 1, publish: 2 };

const workers = JOB_CLASSES.map((jobClass) => {
  const worker = new Worker<QueuedJobData>(
    jobClass,
    (job) =>
      withCorrelation(job.data.correlationId, async () => {
        log.info({ jobClass, generator: job.name, jobId: job.data.jobId }, 'job started');
        const result = await processJob({ db, handlers, log }, job.data);
        log.info({ jobClass, generator: job.name, jobId: job.data.jobId, result }, 'job ended');
        return result;
      }),
    { connection, concurrency: CONCURRENCY[jobClass] },
  );
  worker.on('failed', (job, err) =>
    withCorrelation(job?.data.correlationId, () =>
      log.error({ jobClass, generator: job?.name, jobId: job?.data.jobId, err }, 'job errored'),
    ),
  );
  worker.on('error', (err) => reportError(jobClass, err));
  return worker;
});

log.info({ jobClasses: JOB_CLASSES, providers: env.PROVIDERS }, 'worker started');

async function shutdown(signal: string) {
  log.info({ signal }, 'worker stopping');
  await Promise.all(workers.map((w) => w.close()));
  await closeQueues(queues);
  await connection.quit();
  await db.close();
  process.exit(0);
}

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));
