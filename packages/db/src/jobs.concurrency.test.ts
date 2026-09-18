import { randomUUID } from 'node:crypto';
import { loadRootEnvFile } from '@cgp/config';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, type Database } from './client';
import { createJobWithHold, ledgerDrift, settleJob, type NewJob } from './jobs';
import { runMigrations } from './migrate';
import { creditLedger } from './schema';
import { scoped } from './scoped';
import { createTestWorkspace } from './testing';

// PGlite has one connection, so it cannot show two writers racing for the same balance. These
// run against a real Postgres, in a throwaway database created here and dropped afterwards,
// so nothing touches the data behind DATABASE_URL. Skipped unless TEST_DATABASE_URL is set.
loadRootEnvFile();
const serverUrl = process.env.TEST_DATABASE_URL;

const telemetry = { actionClass: 'caption_set', provider: 'fake', realisedCostInr: 0 };
const newJob = (workspaceId: string, credits: number): NewJob => ({
  workspaceId,
  jobClass: 'inference',
  generatorKey: 'caption_set',
  hold: { credits, videoSeconds: 0 },
});

describe.skipIf(!serverUrl)(
  'job engine under concurrency (real Postgres)',
  { timeout: 60_000 },
  () => {
    const name = `cgp_test_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
    let admin: postgres.Sql;
    let db: Database;

    beforeAll(async () => {
      admin = postgres(serverUrl!, { max: 1, onnotice: () => {} });
      await admin.unsafe(`create database "${name}"`);
      const url = new URL(serverUrl!);
      url.pathname = `/${name}`;
      await runMigrations(url.toString());
      db = createDatabase(url.toString(), { max: 10 });
    }, 120_000);

    afterAll(async () => {
      await db?.close();
      await admin?.unsafe(`drop database if exists "${name}" with (force)`);
      await admin?.end();
    }, 60_000);

    it('holds exactly as many jobs as the balance covers, never going negative', async () => {
      const ws = await createTestWorkspace(db, { credits: 100 });

      const results = await Promise.all(
        Array.from({ length: 20 }, () => createJobWithHold(db, newJob(ws, 10))),
      );

      expect(results.filter((r) => r.ok)).toHaveLength(10);
      expect(results.filter((r) => !r.ok).map((r) => (r.ok ? '' : r.reason))).toEqual(
        Array(10).fill('insufficient_credits'),
      );
      expect((await scoped(db, ws).workspace())?.creditBalance).toBe(0);
      expect(await ledgerDrift(db)).toEqual([]);
    });

    it('applies exactly one of several simultaneous settles for the same job', async () => {
      const ws = await createTestWorkspace(db, { credits: 50 });
      const result = await createJobWithHold(db, newJob(ws, 10));
      if (!result.ok) throw new Error(result.reason);

      const settles = await Promise.all(
        Array.from({ length: 5 }, () =>
          settleJob(db, result.job.id, { credits: 6, videoSeconds: 0 }, telemetry),
        ),
      );

      expect(settles.filter((s) => s.applied)).toHaveLength(1);
      const entries = await scoped(db, ws).select(creditLedger, {
        where: (t, op) => op.and(op.eq(t.jobId, result.job.id), op.eq(t.reason, 'settle')),
      });
      expect(entries.map((e) => e.delta)).toEqual([4]);
      expect((await scoped(db, ws).workspace())?.creditBalance).toBe(44);
      expect(await ledgerDrift(db)).toEqual([]);
    });
  },
);
