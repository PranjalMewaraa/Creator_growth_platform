import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { catalog } from './catalog';
import type { Database } from './client';
import { brandKits, creditLedger, meteringRates, workspaceProfiles } from './schema';
import { scoped } from './scoped';
import { METERING_RATES_V1, seedDemo } from './seed';
import { createTestDatabase } from './testing';

let db: Database;

beforeAll(async () => {
  db = await createTestDatabase();
});

afterAll(() => db.close());

describe('seedDemo', () => {
  it('creates a populated and a near empty workspace, funded through the ledger', async () => {
    const result = await seedDemo(db, { ownerEmail: 'owner@example.com' });
    expect(result.skipped).toBe(false);
    const [populated, nearEmpty] = result.workspaceIds;

    const rates = await catalog(db).select(meteringRates);
    expect(rates.map((r) => r.credits)).toEqual([METERING_RATES_V1.credits]);

    expect(await scoped(db, populated!).select(workspaceProfiles)).toHaveLength(1);
    expect(await scoped(db, populated!).select(brandKits)).toHaveLength(1);
    expect(await scoped(db, nearEmpty!).select(workspaceProfiles)).toHaveLength(0);

    for (const id of result.workspaceIds) {
      const s = scoped(db, id);
      const workspace = await s.workspace();
      const entries = await s.select(creditLedger);
      expect(entries.every((e) => e.reason === 'grant')).toBe(true);
      const sum = (c: string) =>
        entries.filter((e) => e.currency === c).reduce((t, e) => t + e.delta, 0);
      expect(workspace?.creditBalance).toBe(sum('credits'));
      expect(workspace?.videoSecondsBalance).toBe(sum('video_seconds'));
    }
  });

  it('skips when the owner already exists', async () => {
    expect(await seedDemo(db, { ownerEmail: 'owner@example.com' })).toEqual({
      skipped: true,
      workspaceIds: [],
    });
  });
});
