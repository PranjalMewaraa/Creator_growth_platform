import { JOB_CLASSES, type JobClass, type QueuedJobData } from '@cgp/contracts';
import {
  baseEnvSchema,
  createLogger,
  decryptSecret,
  loadRootEnvFile,
  parseEncryptionKey,
  parseEnv,
  resolveToolPath,
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
  createRedrawFrameHandler,
  createStoryboardHandler,
  createVideoHandlers,
  generators,
  processJob,
  publishDelta,
  publishStage,
  startDispatcher,
  startTrendIngestion,
  sweepOnBoot,
  waitForRedis,
} from '@cgp/core';
import {
  createProviders,
  fetchAutocompleteSignals,
  fetchRedditSignals,
  fetchYouTubeSignals,
  warmProviders,
} from '@cgp/adapters';
import { brandKits, createDatabase, PUBLISH_TARGET, scoped } from '@cgp/db';
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

// From here on the same query runs on a tick, which is what makes a scheduled post go out and
// a failed one come back (WP31).
const stopDispatcher = startDispatcher({ db, queues, log });

const providers = createProviders({ ...env, log });

// Trend Radar's own tick (WP61), independent of the job dispatcher above: nothing here is a
// job a creator is waiting on, so it runs on its own clock rather than through the queue.
const stopTrendIngestion = startTrendIngestion(
  {
    db,
    youtubeApiKey: env.YOUTUBE_API_KEY,
    // The same provider the compile rewrite and scene planner already use (WP57/59) — no new
    // key, no new provider to stand up for this.
    synthesisProvider: providers.rewriters[0],
    moderation: providers.moderation,
    log,
    fetchYouTube: fetchYouTubeSignals,
    fetchAutocomplete: fetchAutocompleteSignals,
    fetchReddit: fetchRedditSignals,
    niches: env.TRENDS_NICHES,
  },
  { everyMs: env.TRENDS_INGEST_EVERY_MS },
);
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
    capabilityOf: providers.imageCapability,
  }),
  ...createStoryboardHandler({
    db,
    registry: generators,
    adapters: providers.image,
    planner: providers.rewriters[0],
    moderation: providers.moderation,
    store: providers.store,
    capabilityOf: providers.imageCapability,
    publishStage: (jobId, stage) => publishStage(connection, jobId, stage),
    costInr: providers.imageCostInr,
    providerLabel: providers.mode === 'real' ? 'vertex' : 'fake',
  }),
  // The same deps as the storyboard, minus the planner: a redraw has its scene already.
  ...createRedrawFrameHandler({
    db,
    registry: generators,
    adapters: providers.image,
    moderation: providers.moderation,
    store: providers.store,
    capabilityOf: providers.imageCapability,
    publishStage: (jobId, stage) => publishStage(connection, jobId, stage),
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
    capabilityOf: providers.videoCapability,
    publishStage: (jobId, stage) => publishStage(connection, jobId, stage),
    providerLabel: providers.mode === 'real' ? 'vertex' : 'fake',
    ffmpeg: { bin: resolveToolPath(env.FFMPEG_PATH) },
    voice: providers.voice['neural2-en-in'],
    voiceCostInr: providers.voiceCostInr,
    logo: (workspaceId) => workspaceLogo(db, providers.store, workspaceId),
  }),
  ...publishHandlers(),
};

/** The workspace's logo, for the corner of a reel. Absent until a brand kit has one. */
async function workspaceLogo(
  database: typeof db,
  store: typeof providers.store,
  workspaceId: string,
) {
  const [kit] = await scoped(database, workspaceId).select(brandKits, {
    orderBy: (t, order) => order.desc(t.version),
    limit: 1,
  });
  if (!kit?.logoUrl) return undefined;
  const key = new URL(kit.logoUrl).pathname.split('/').slice(2).join('/');
  try {
    return { data: await store.get(key), mimeType: 'image/png' };
  } catch {
    return undefined;
  }
}

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
    { connection, concurrency: CONCURRENCY[jobClass], skipVersionCheck: true },
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
  stopDispatcher();
  stopTrendIngestion();
  await Promise.all(workers.map((w) => w.close()));
  await closeQueues(queues);
  await connection.quit();
  await db.close();
  process.exit(0);
}

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));
