// A library of prior outputs, so the Studio opens populated (plan section 15, week 8).
//
//   pnpm --filter @cgp/worker seed:library <workspace id> [--dry-run] [--only=script,image]
//
// These are real generations through the real pipeline: the engine compiles, the provider
// answers, moderation checks, and the output is stored with its lineage. There is no other
// honest way to fill a library — a fixture in the Studio is a lie told to the person running
// the demo as much as to the room.
//
// With PROVIDERS=real this spends money and credits. The header below prints the estimate and
// --dry-run prints it without spending anything. No video: a reel is eight of the workspace's
// video seconds and the template gallery already has four to show.
import { baseEnvSchema, createLogger, loadRootEnvFile, parseEnv } from '@cgp/config';
import { createProviders } from '@cgp/adapters';
import {
  createImageHandlers,
  createTextHandlers,
  generators,
  processJob,
  startGeneration,
  type Queues,
} from '@cgp/core';
import { createDatabase, scoped, jobs as jobsTable } from '@cgp/db';

loadRootEnvFile();
const env = parseEnv(baseEnvSchema);
const log = createLogger({ service: 'seed-library', level: env.LOG_LEVEL });

/**
 * The work a coffee business would have in its Studio after a month: a few scripts, some
 * captions, the openers, a couple of pictures and one thumbnail set. Ordered oldest first, so
 * the Library's newest-first list ends up looking deliberate.
 */
const WORK: Array<{ generatorKey: string; intentText: string; targetPlatform: string }> = [
  {
    generatorKey: 'script',
    intentText: 'why our cold brew steeps for eighteen hours',
    targetPlatform: 'instagram',
  },
  {
    generatorKey: 'caption_set',
    intentText: 'the new bottle design, finally in',
    targetPlatform: 'instagram',
  },
  {
    generatorKey: 'hook_title_set',
    intentText: 'what most people get wrong about iced coffee',
    targetPlatform: 'instagram',
  },
  {
    generatorKey: 'script',
    intentText: 'a morning delivery run across Jaipur',
    targetPlatform: 'instagram',
  },
  {
    generatorKey: 'image',
    intentText: 'a bottle of cold brew on a steel counter at dawn',
    targetPlatform: 'instagram',
  },
  {
    generatorKey: 'caption_set',
    intentText: 'thanking the first hundred customers',
    targetPlatform: 'linkedin',
  },
  {
    generatorKey: 'script',
    intentText: 'how we choose which roastery to work with',
    targetPlatform: 'linkedin',
  },
  {
    generatorKey: 'hook_title_set',
    intentText: 'the one mistake that ruins a batch',
    targetPlatform: 'instagram',
  },
  {
    generatorKey: 'caption_set',
    intentText: 'weekend market stall, where to find us',
    targetPlatform: 'instagram',
  },
  {
    generatorKey: 'image',
    intentText: 'hands pouring cold brew over ice, close and unhurried',
    targetPlatform: 'instagram',
  },
  {
    generatorKey: 'script',
    intentText: 'what eighteen months of running this taught me',
    targetPlatform: 'linkedin',
  },
  {
    generatorKey: 'thumbnail_set',
    intentText: 'the cold brew method, explained',
    targetPlatform: 'instagram',
  },
];

/** Plan section 7, so the estimate is the same number the Studio shows before submitting. */
const CREDITS: Record<string, number> = {
  script: 6,
  hook_title_set: 1,
  caption_set: 1,
  image: 15,
  thumbnail_set: 36,
};

const args = process.argv.slice(2);
const [workspaceId] = args.filter((arg) => !arg.startsWith('--'));
if (!workspaceId) throw new Error('Usage: seed:library <workspace id> [--dry-run] [--only=...]');
const dryRun = args.includes('--dry-run');
const only = args
  .find((arg) => arg.startsWith('--only='))
  ?.split('=')[1]
  ?.split(',');
const work = only ? WORK.filter((item) => only.includes(item.generatorKey)) : WORK;

const credits = work.reduce((sum, item) => sum + (CREDITS[item.generatorKey] ?? 0), 0);
log.info(
  {
    jobs: work.length,
    credits,
    providers: env.PROVIDERS,
    note: 'pictures are about INR 3 each; a thumbnail set is three of them',
  },
  dryRun ? 'dry run: nothing will be generated' : 'generating the library',
);
if (dryRun) process.exit(0);

const db = createDatabase(env.DATABASE_URL);
const providers = createProviders({ ...env, log });

/**
 * Never enqueued: the same reason the preview pipeline does not. A running worker would take
 * the job as well and generate it a second time against the real providers.
 */
const NOT_QUEUED = {
  inference: { add: () => Promise.resolve() },
  render: { add: () => Promise.resolve() },
  publish: { add: () => Promise.resolve() },
} as unknown as Queues;

const providerLabel = providers.mode === 'real' ? 'vertex' : 'fake';
const handlers = {
  ...createTextHandlers({
    db,
    registry: generators,
    adapters: providers.text,
    moderation: providers.moderation,
    // Nobody is watching a stream here, so the deltas go nowhere.
    publishDelta: () => Promise.resolve(),
    costInr: providers.textCostInr,
    providerLabel,
  }),
  ...createImageHandlers({
    db,
    registry: generators,
    adapters: providers.image,
    moderation: providers.moderation,
    store: providers.store,
    costInr: providers.imageCostInr,
    providerLabel,
  }),
};

let made = 0;
let failed = 0;
try {
  for (const item of work) {
    const started = await startGeneration(
      {
        db,
        queues: NOT_QUEUED,
        log,
        registry: generators,
        compile: { rewriters: providers.rewriters },
        moderation: providers.moderation,
      },
      {
        workspaceId,
        generatorKey: item.generatorKey,
        input: { intentText: item.intentText, targetPlatform: item.targetPlatform },
      },
    );
    if (!started.ok) {
      log.warn({ generator: item.generatorKey, reason: started.reason }, 'not started');
      failed += 1;
      continue;
    }

    const result = await processJob(
      { db, handlers, log },
      { jobId: started.job.id, correlationId: started.job.id },
    );
    if (result === 'settled') {
      made += 1;
      log.info({ generator: item.generatorKey, intent: item.intentText }, 'made');
    } else {
      failed += 1;
      const [job] = await scoped(db, workspaceId).select(jobsTable, {
        where: (t, op) => op.eq(t.id, started.job.id),
        limit: 1,
      });
      log.warn({ generator: item.generatorKey, result, error: job?.error }, 'did not settle');
    }
  }
} finally {
  const workspace = await scoped(db, workspaceId).workspace();
  log.info({ made, failed, creditsLeft: workspace?.creditBalance }, 'library done');
  await db.close();
}
