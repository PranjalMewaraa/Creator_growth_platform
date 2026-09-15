// Dev smoke test: pnpm --filter @cgp/worker enqueue:noop [inference|render|publish]
// Enqueues straight to Redis with no Postgres job row. Real jobs never do this (invariant 7).
import { randomUUID } from 'node:crypto';
import { JOB_CLASSES, type JobClass, type QueuedJobData } from '@cgp/contracts';
import { baseEnvSchema, loadRootEnvFile, parseEnv } from '@cgp/config';
import { Queue } from 'bullmq';
import { createRedis } from '../src/redis';

const jobClass = (process.argv[2] ?? 'inference') as JobClass;
if (!JOB_CLASSES.includes(jobClass)) {
  throw new Error(`Job class must be one of ${JOB_CLASSES.join(', ')}`);
}

loadRootEnvFile();
const env = parseEnv(baseEnvSchema);
const connection = createRedis(env.REDIS_URL);
// A smoke test should fail fast rather than retry forever.
connection.once('error', (err: NodeJS.ErrnoException) => {
  console.error(`Redis unavailable: ${err.code ?? err.message}`);
  process.exit(1);
});
const queue = new Queue<QueuedJobData>(jobClass, { connection });

const jobId = randomUUID();
await queue.add('noop', { jobId, correlationId: randomUUID() }, { jobId });
console.log(`Enqueued noop ${jobClass} job ${jobId}`);

await queue.close();
await connection.quit();
