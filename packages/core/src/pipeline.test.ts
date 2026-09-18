import { randomUUID } from 'node:crypto';
import { createLogger, loadRootEnvFile } from '@cgp/config';
import type { JobStatus } from '@cgp/contracts';
import { createJobWithHold, jobs, scoped, type Database, type JobRow } from '@cgp/db';
import { createTestDatabase, createTestWorkspace } from '@cgp/db/testing';
import { Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { JobBlocked, processJob, type JobHandler } from './process';
import { closeQueues, createQueues, enqueue, type Queues } from './queues';
import { submitJob } from './submit';
import { sweepOnBoot } from './sweep';

// Needs a real Redis (REDIS_URL). Skipped when none answers, as in CI. Keys use a unique
// prefix, so a worker running against the same Redis never sees these jobs.
loadRootEnvFile();
const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';
const redisUp = await (async () => {
  const probe = new Redis(redisUrl, {
    lazyConnect: true,
    connectTimeout: 1500,
    maxRetriesPerRequest: 0,
  });
  try {
    await probe.connect();
    return (await probe.ping()) === 'PONG';
  } catch {
    return false;
  } finally {
    probe.disconnect();
  }
})();

const log = createLogger({ service: 'test', level: 'silent' });
const telemetry = { actionClass: 'test', provider: 'fake', realisedCostInr: 0 };

const handlers: Record<string, JobHandler> = {
  'charge-held': (job) =>
    Promise.resolve({
      actual: { credits: job.creditsHeld, videoSeconds: job.videoSecondsHeld },
      telemetry,
    }),
  'charge-less': (job) =>
    Promise.resolve({
      actual: { credits: Math.max(0, job.creditsHeld - 2), videoSeconds: 0 },
      telemetry,
    }),
  fail: () => Promise.reject(new Error('provider timed out')),
  block: () => Promise.reject(new JobBlocked('violence')),
};

describe.skipIf(!redisUp)('job pipeline with Redis', { timeout: 30_000 }, () => {
  let db: Database;
  let connection: Redis;
  let queues: Queues;
  let worker: Worker;
  const prefix = `cgp-test-${randomUUID().slice(0, 8)}`;

  beforeAll(async () => {
    db = await createTestDatabase();
    connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
    queues = createQueues(connection, { prefix });
    worker = new Worker(
      'inference',
      (job) =>
        processJob({ db, handlers, log }, job.data as { jobId: string; correlationId: string }),
      { connection, prefix },
    );
  });

  afterAll(async () => {
    await worker?.close();
    await Promise.all(Object.values(queues ?? {}).map((q) => q.obliterate({ force: true })));
    await closeQueues(queues);
    await connection?.quit();
    await db?.close();
  });

  async function waitFor(
    workspaceId: string,
    jobId: string,
    statuses: JobStatus[],
  ): Promise<JobRow> {
    const deadline = Date.now() + 20_000;
    for (;;) {
      const [job] = await scoped(db, workspaceId).select(jobs, {
        where: (t, op) => op.eq(t.id, jobId),
      });
      if (job && statuses.includes(job.status)) return job;
      if (Date.now() > deadline) throw new Error(`job ${jobId} stuck at ${job?.status}`);
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  const balance = async (ws: string) => (await scoped(db, ws).workspace())?.creditBalance;

  it('holds on submit, runs on the queue, and settles the actual cost', async () => {
    const ws = await createTestWorkspace(db, { credits: 50 });
    const result = await submitJob(
      { db, queues, log },
      {
        workspaceId: ws,
        jobClass: 'inference',
        generatorKey: 'charge-less',
        estimate: { credits: 10, breakdown: [] },
      },
    );
    if (!result.ok) throw new Error(result.reason);
    expect(await balance(ws)).toBe(40);

    const done = await waitFor(ws, result.job.id, ['COMPLETE']);
    expect(done.creditsSettled).toBe(8);
    expect(await balance(ws)).toBe(42);
  });

  it('recovers a job that never reached the queue, through the boot sweep', async () => {
    const ws = await createTestWorkspace(db, { credits: 50 });
    // As if Redis were wiped, or the enqueue failed, after the hold committed.
    const created = await createJobWithHold(db, {
      workspaceId: ws,
      jobClass: 'inference',
      generatorKey: 'charge-held',
      hold: { credits: 6, videoSeconds: 0 },
    });
    if (!created.ok) throw new Error(created.reason);

    await new Promise((r) => setTimeout(r, 300));
    const [before] = await scoped(db, ws).select(jobs, {
      where: (t, op) => op.eq(t.id, created.job.id),
    });
    expect(before?.status).toBe('QUEUED');

    const sweep = await sweepOnBoot({ db, queues, log });
    expect(sweep.requeued).toBeGreaterThanOrEqual(1);
    expect(sweep.driftedWorkspaces).toBe(0);
    await waitFor(ws, created.job.id, ['COMPLETE']);
    expect(await balance(ws)).toBe(44);
  });

  it('refunds in full when the generator fails or is blocked', async () => {
    const ws = await createTestWorkspace(db, { credits: 50 });
    const submit = (generatorKey: string) =>
      submitJob(
        { db, queues, log },
        {
          workspaceId: ws,
          jobClass: 'inference',
          generatorKey,
          estimate: { credits: 15, breakdown: [] },
        },
      );
    const failed = await submit('fail');
    const blocked = await submit('block');
    if (!failed.ok || !blocked.ok) throw new Error('submit rejected');

    expect(await waitFor(ws, failed.job.id, ['FAILED'])).toMatchObject({
      error: { code: 'GENERATION_FAILED' },
    });
    expect(await waitFor(ws, blocked.job.id, ['BLOCKED'])).toMatchObject({
      error: { code: 'MODERATION_BLOCKED', category: 'violence' },
    });
    expect(await balance(ws)).toBe(50);
  });

  it('settles once when the same job is delivered twice', async () => {
    const ws = await createTestWorkspace(db, { credits: 50 });
    const created = await createJobWithHold(db, {
      workspaceId: ws,
      jobClass: 'inference',
      generatorKey: 'charge-held',
      hold: { credits: 5, videoSeconds: 0 },
    });
    if (!created.ok) throw new Error(created.reason);

    await enqueue(queues, created.job);
    await enqueue(queues, created.job);
    await waitFor(ws, created.job.id, ['COMPLETE']);
    expect(
      await processJob({ db, handlers, log }, { jobId: created.job.id, correlationId: 'x' }),
    ).toBe('skipped');
    expect(await balance(ws)).toBe(45);
  });
});
