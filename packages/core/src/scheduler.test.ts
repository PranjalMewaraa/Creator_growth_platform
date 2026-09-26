import { createLogger } from '@cgp/config';
import type { QueuedJobData } from '@cgp/contracts';
import { createJobWithHold, jobs, scoped, type Database } from '@cgp/db';
import { createTestDatabase, createTestWorkspace } from '@cgp/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Queues } from './queues';
import { dispatchDue } from './scheduler';
import { sweepOnBoot } from './sweep';

const log = createLogger({ service: 'test', level: 'silent' });

function recordingQueues() {
  const added: QueuedJobData[] = [];
  const queue = { add: (_: string, data: QueuedJobData) => Promise.resolve(added.push(data)) };
  return {
    queues: { inference: queue, render: queue, publish: queue } as unknown as Queues,
    added,
  };
}

let db: Database;
beforeAll(async () => {
  db = await createTestDatabase();
});
afterAll(async () => {
  await db.close();
});

/** A queued job that may not run before `runAt`. */
async function jobDue(runAt: Date) {
  const workspaceId = await createTestWorkspace(db, { credits: 100 });
  const created = await createJobWithHold(db, {
    workspaceId,
    jobClass: 'publish',
    generatorKey: 'publish_target',
    hold: { credits: 0, videoSeconds: 0 },
    runAt,
  });
  if (!created.ok) throw new Error(created.reason);
  return { workspaceId, job: created.job };
}

const minutes = (n: number) => new Date(Date.now() + n * 60_000);

describe('the dispatcher (WP31)', () => {
  it('leaves a job alone until its time, then queues it', async () => {
    const { job } = await jobDue(minutes(30));
    const { queues, added } = recordingQueues();

    await dispatchDue({ db, queues, log });
    expect(added.map((d) => d.jobId)).not.toContain(job.id);

    // The clock moves on; nothing about the job changes but the time it is asked about.
    await scoped(db, job.workspaceId).update(jobs, { runAt: minutes(-1) }, (t, op) =>
      op.eq(t.id, job.id),
    );
    await dispatchDue({ db, queues, log });
    expect(added.map((d) => d.jobId)).toContain(job.id);
  });

  it('does not fire next week’s posts when a worker boots', async () => {
    const { job } = await jobDue(minutes(60 * 24 * 7));
    const { queues, added } = recordingQueues();

    await sweepOnBoot({ db, queues, log });

    expect(added.map((d) => d.jobId)).not.toContain(job.id);
  });

  it('recovers a job a dead worker left running, whatever its time says', async () => {
    const { job } = await jobDue(minutes(60));
    await scoped(db, job.workspaceId).update(
      jobs,
      // As a crash leaves it: running, and not touched for an hour.
      { status: 'RUNNING', updatedAt: minutes(-60) },
      (t, op) => op.eq(t.id, job.id),
    );
    const { queues, added } = recordingQueues();

    await dispatchDue({ db, queues, log });

    expect(added.map((d) => d.jobId)).toContain(job.id);
  });

  it('carries the job’s own correlation id, so a scheduled post is traceable', async () => {
    const { job } = await jobDue(minutes(-1));
    const { queues, added } = recordingQueues();

    await dispatchDue({ db, queues, log });

    expect(added.find((d) => d.jobId === job.id)?.correlationId).toBe(job.id);
  });
});
