import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { unwrap, type Database } from './client';
import {
  createJobWithHold,
  jobsToRecover,
  ledgerDrift,
  markJobRunning,
  refundJob,
  settleJob,
  type NewJob,
} from './jobs';
import { costTelemetry, creditLedger, jobs } from './schema';
import { scoped } from './scoped';
import { createTestDatabase, createTestWorkspace } from './testing';

let db: Database;

const telemetry = { actionClass: 'caption_set', provider: 'fake', realisedCostInr: 0.11 };

function newJob(workspaceId: string, credits: number, videoSeconds = 0): NewJob {
  return {
    workspaceId,
    jobClass: 'inference',
    generatorKey: 'caption_set',
    hold: { credits, videoSeconds },
  };
}

async function balance(workspaceId: string) {
  const w = await scoped(db, workspaceId).workspace();
  return { credits: w?.creditBalance, videoSeconds: w?.videoSecondsBalance };
}

async function created(workspaceId: string, credits: number, videoSeconds = 0) {
  const result = await createJobWithHold(db, newJob(workspaceId, credits, videoSeconds));
  if (!result.ok) throw new Error(`expected a job, got ${result.reason}`);
  return result.job;
}

beforeAll(async () => {
  db = await createTestDatabase();
});

afterAll(() => db.close());

describe('createJobWithHold', () => {
  it('holds the estimate in the same transaction that creates the job', async () => {
    const ws = await createTestWorkspace(db, { credits: 50, videoSeconds: 24 });
    const job = await created(ws, 6, 8);

    expect(job).toMatchObject({ status: 'QUEUED', creditsHeld: 6, videoSecondsHeld: 8 });
    expect(await balance(ws)).toEqual({ credits: 44, videoSeconds: 16 });
    const holds = await scoped(db, ws).select(creditLedger, {
      where: (t, op) => op.eq(t.jobId, job.id),
    });
    expect(holds.map((h) => [h.currency, h.delta, h.reason]).sort()).toEqual([
      ['credits', -6, 'hold'],
      ['video_seconds', -8, 'hold'],
    ]);
  });

  it('rejects before any job exists when the balance cannot cover the hold', async () => {
    const ws = await createTestWorkspace(db, { credits: 5 });

    expect(await createJobWithHold(db, newJob(ws, 6))).toEqual({
      ok: false,
      reason: 'insufficient_credits',
    });
    expect(await createJobWithHold(db, newJob(ws, 1, 8))).toEqual({
      ok: false,
      reason: 'insufficient_video_seconds',
    });
    expect(await scoped(db, ws).select(jobs)).toEqual([]);
    expect(await balance(ws)).toEqual({ credits: 5, videoSeconds: 0 });
  });

  it('creates a free job with no ledger entries', async () => {
    const ws = await createTestWorkspace(db);
    const job = await created(ws, 0);
    expect(await scoped(db, ws).select(creditLedger)).toEqual([]);
    expect(job.creditsHeld).toBe(0);
  });

  it('refuses a hold that is not a whole, non-negative number', async () => {
    const ws = await createTestWorkspace(db, { credits: 10 });
    await expect(createJobWithHold(db, newJob(ws, 1.5))).rejects.toThrow(/whole number/);
    await expect(createJobWithHold(db, newJob(ws, -1))).rejects.toThrow(/whole number/);
  });
});

describe('settleJob', () => {
  it('charges the actual cost, releases the rest, and records telemetry', async () => {
    const ws = await createTestWorkspace(db, { credits: 50 });
    const job = await created(ws, 15);

    const result = await settleJob(db, job.id, { credits: 12, videoSeconds: 0 }, telemetry);

    expect(result.applied).toBe(true);
    expect(result.job).toMatchObject({ status: 'COMPLETE', creditsSettled: 12 });
    expect(await balance(ws)).toEqual({ credits: 38, videoSeconds: 0 });
    const [settle] = await scoped(db, ws).select(creditLedger, {
      where: (t, op) => op.and(op.eq(t.jobId, job.id), op.eq(t.reason, 'settle')),
    });
    expect(settle?.delta).toBe(3);
    const rows = await scoped(db, ws).select(costTelemetry, {
      where: (t, op) => op.eq(t.jobId, job.id),
    });
    expect(rows.map((r) => [r.provider, r.realisedCostInr])).toEqual([['fake', '0.1100']]);
  });

  it('is a no-op the second time, and after a refund', async () => {
    const ws = await createTestWorkspace(db, { credits: 50 });
    const settledJob = await created(ws, 10);
    await settleJob(db, settledJob.id, { credits: 10, videoSeconds: 0 }, telemetry);
    const again = await settleJob(db, settledJob.id, { credits: 1, videoSeconds: 0 }, telemetry);
    expect(again.applied).toBe(false);

    const refundedJob = await created(ws, 10);
    await refundJob(db, refundedJob.id, 'FAILED');
    const late = await settleJob(db, refundedJob.id, { credits: 10, videoSeconds: 0 }, telemetry);
    expect(late.applied).toBe(false);

    expect(await balance(ws)).toEqual({ credits: 40, videoSeconds: 0 });
  });

  it('never charges more than was held', async () => {
    const ws = await createTestWorkspace(db, { credits: 50 });
    const job = await created(ws, 6);
    await expect(settleJob(db, job.id, { credits: 7, videoSeconds: 0 }, telemetry)).rejects.toThrow(
      /exceeds the hold/,
    );
    expect(await balance(ws)).toEqual({ credits: 44, videoSeconds: 0 });
    expect((await markJobRunning(db, job.id))?.status).toBe('RUNNING');
  });
});

describe('refundJob', () => {
  it('returns the whole hold in every currency and records why', async () => {
    const ws = await createTestWorkspace(db, { credits: 20, videoSeconds: 24 });
    const job = await created(ws, 6, 24);

    const result = await refundJob(db, job.id, 'BLOCKED', {
      code: 'MODERATION_BLOCKED',
      message: 'Blocked by moderation',
      category: 'violence',
    });

    expect(result.job).toMatchObject({ status: 'BLOCKED', error: { category: 'violence' } });
    expect(await balance(ws)).toEqual({ credits: 20, videoSeconds: 24 });
    expect((await refundJob(db, job.id, 'FAILED')).applied).toBe(false);
  });
});

describe('recovery', () => {
  it('finds waiting jobs and jobs left running too long, but not finished or fresh ones', async () => {
    const ws = await createTestWorkspace(db, { credits: 100 });
    const waiting = await created(ws, 1);
    const stale = await created(ws, 1);
    const fresh = await created(ws, 1);
    const done = await created(ws, 1);
    await markJobRunning(db, stale.id);
    await markJobRunning(db, fresh.id);
    await settleJob(db, done.id, { credits: 1, videoSeconds: 0 }, telemetry);
    // Backdate the stale job as if its worker died an hour ago.
    await unwrap(db)
      .update(jobs)
      .set({ updatedAt: new Date(Date.now() - 60 * 60_000) })
      .where(eq(jobs.id, stale.id));

    const found = await jobsToRecover(db, {
      staleRunningBefore: new Date(Date.now() - 10 * 60_000),
    });
    const ids = found.map((j) => j.id);

    expect(ids).toContain(waiting.id);
    expect(ids).toContain(stale.id);
    expect(ids).not.toContain(fresh.id);
    expect(ids).not.toContain(done.id);
  });

  it('leaves every cached balance equal to its ledger sum', async () => {
    expect(await ledgerDrift(db)).toEqual([]);
  });
});
