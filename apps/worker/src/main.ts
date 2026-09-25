import { JOB_CLASSES, type JobClass, type QueuedJobData } from '@cgp/contracts';
import {
  baseEnvSchema,
  createLogger,
  decryptSecret,
  loadRootEnvFile,
  parseEncryptionKey,
  parseEnv,
  withCorrelation,
} from '@cgp/config';
import {
  closeQueues,
  createQueues,
  createRedis,
  createPublishHandler,
  type JobHandler,
  createImageHandlers,
  createTextHandlers,
  createVideoHandlers,
  generators,
  processJob,
  publishDelta,
  sweepOnBoot,
  waitForRedis,
} from '@cgp/core';
import { createProviders, warmProviders } from '@cgp/adapters';
import { createDatabase, PUBLISH_TARGET } from '@cgp/db';
import { Worker } from 'bullmq';
import { createErrorThrottle } from './error-throttle';
import { handlers as baseHandlers } from './handlers';

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

const providers = createProviders({ ...env, log });
// Pays the connection and token cost before the first job does (D17). Best effort, in the
// background: the worker takes work whether or not it finishes.
void warmProviders(providers, log);
const handlers = {
  ...baseHandlers,
  ...createTextHandlers({
    db,
    registry: generators,
    adapters: providers.text,
    moderation: providers.moderation,
    publishDelta: (jobId, text) => publishDelta(connection, jobId, text),
    costInr: providers.textCostInr,
    providerLabel: providers.mode === 'real' ? 'vertex' : 'fake',
  }),
  ...createImageHandlers({
    db,
    registry: generators,
    adapters: providers.image,
    moderation: providers.moderation,
    store: providers.store,
    costInr: providers.imageCostInr,
    providerLabel: providers.mode === 'real' ? 'vertex' : 'fake',
  }),
  ...createVideoHandlers({
    db,
    registry: generators,
    adapters: providers.video,
    // The scene planner is the engine's own provider, the same one that rewrites a brief.
    planner: providers.rewriters[0],
    moderation: providers.moderation,
    store: providers.store,
    costInr: providers.videoCostInr,
    providerLabel: providers.mode === 'real' ? 'vertex' : 'fake',
  }),
  ...publishHandlers(),
};

/** Publishing needs the token key; without it the worker still runs everything else. */
function publishHandlers(): Record<string, JobHandler> {
  if (!env.TOKEN_ENCRYPTION_KEY) {
    log.warn('TOKEN_ENCRYPTION_KEY is not set: publish jobs will fail');
    return {};
  }
  const kek = parseEncryptionKey(env.TOKEN_ENCRYPTION_KEY);
  return {
    [PUBLISH_TARGET]: createPublishHandler({
      db,
      publishers: providers.publishers,
      decryptToken: (ciphertext) => decryptSecret(kek, ciphertext),
    }),
  };
}

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

log.info(
  {
    jobClasses: JOB_CLASSES,
    providers: env.PROVIDERS,
    moderation: env.MODERATION,
    publishing: env.PUBLISHING,
    generators: Object.keys(handlers),
  },
  'worker started',
);

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
