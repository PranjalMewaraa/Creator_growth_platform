// Dev smoke test: pnpm --filter @cgp/worker enqueue:noop <workspace id> [inference|render|publish]
// Submits a free noop job the real way: job row in Postgres first, then the queue (invariant 7).
// With the worker running, the job should end COMPLETE within a second or two.
import { randomUUID } from 'node:crypto';
import { JOB_CLASSES, type JobClass } from '@cgp/contracts';
import { baseEnvSchema, createLogger, loadRootEnvFile, parseEnv } from '@cgp/config';
import { closeQueues, createQueues, submitJob } from '@cgp/core';
import { createDatabase } from '@cgp/db';
import { createRedis } from '../src/redis';

const [workspaceId, jobClassArg = 'inference'] = process.argv.slice(2);
if (!workspaceId) throw new Error('Usage: enqueue:noop <workspace id> [job class]');
const jobClass = jobClassArg as JobClass;
if (!JOB_CLASSES.includes(jobClass)) {
  throw new Error(`Job class must be one of ${JOB_CLASSES.join(', ')}`);
}

loadRootEnvFile();
const env = parseEnv(baseEnvSchema);
const log = createLogger({ service: 'enqueue-noop', level: env.LOG_LEVEL });
const db = createDatabase(env.DATABASE_URL, { max: 1 });
const connection = createRedis(env.REDIS_URL);
// A smoke test should fail fast rather than retry forever.
connection.once('error', (err: NodeJS.ErrnoException) => {
  console.error(`Redis unavailable: ${err.code ?? err.message}`);
  process.exit(1);
});
const queues = createQueues(connection);

try {
  const result = await submitJob(
    { db, queues, log },
    {
      workspaceId,
      jobClass,
      generatorKey: 'noop',
      estimate: { credits: 0, breakdown: [] },
      correlationId: randomUUID(),
    },
  );
  console.log(
    result.ok ? `Submitted noop ${jobClass} job ${result.job.id}` : `Rejected: ${result.reason}`,
  );
} finally {
  await closeQueues(queues);
  await connection.quit();
  await db.close();
}
