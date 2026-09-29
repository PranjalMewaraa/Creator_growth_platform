import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from './client';
import { clearHistory, seedHistory, SEED_POST_PREFIX } from './seed-history';
import { unwrap } from './client';
import { eq } from 'drizzle-orm';
import { jobs, postTargets, publications } from './schema';
import { upsertSocialAccount } from './publishing';
import { createTestDatabase, createTestWorkspace } from './testing';

let db: Database;
beforeAll(async () => {
  db = await createTestDatabase();
});
afterAll(async () => {
  await db.close();
});

const now = new Date('2026-09-29T10:00:00.000Z');

// Scoped on purpose: the tests share one database, so a global count would pick up every
// other case's rows and pass or fail for the wrong reason.
const publicationsOf = (workspaceId: string) =>
  unwrap(db).select().from(publications).where(eq(publications.workspaceId, workspaceId));
const targetsOf = (workspaceId: string) =>
  unwrap(db).select().from(postTargets).where(eq(postTargets.workspaceId, workspaceId));

async function workspaceWithAccounts() {
  const workspaceId = await createTestWorkspace(db);
  for (const platform of ['instagram', 'linkedin'] as const) {
    await upsertSocialAccount(db, {
      workspaceId,
      platform,
      externalId: `${platform}-1`,
      displayName: platform,
      scopes: [],
      tokenCiphertext: 'x',
      tokenExpiresAt: null,
    });
  }
  return workspaceId;
}

describe('seeded calendar history (week 8)', () => {
  it('writes finished posts across the weeks asked for, all in the past', async () => {
    const workspaceId = await workspaceWithAccounts();

    const result = await seedHistory(db, workspaceId, { weeks: 6, perWeek: 4, now });

    expect(result.publications).toBeGreaterThanOrEqual(20);
    const rows = await publicationsOf(workspaceId);
    expect(rows).toHaveLength(result.publications);
    for (const row of rows) {
      expect(row.scheduledAt.getTime()).toBeLessThan(now.getTime());
      expect(row.scheduledAt.getTime()).toBeGreaterThan(now.getTime() - 7 * 7 * 86_400_000);
    }
    const targets = await targetsOf(workspaceId);
    expect(targets.every((t) => t.status === 'published')).toBe(true);
    expect(targets.every((t) => t.platformPostId?.startsWith(SEED_POST_PREFIX))).toBe(true);
  });

  it('enqueues nothing, because a publish job dated last week is one the worker would send', async () => {
    const workspaceId = await workspaceWithAccounts();

    await seedHistory(db, workspaceId, { weeks: 2, perWeek: 3, now });

    // The whole reason this writes rows directly instead of going through createPublication.
    expect(await unwrap(db).select().from(jobs).where(eq(jobs.workspaceId, workspaceId))).toEqual(
      [],
    );
  });

  it('spreads posts over both accounts and more than one day', async () => {
    const workspaceId = await workspaceWithAccounts();

    await seedHistory(db, workspaceId, { weeks: 4, perWeek: 4, now });

    const targets = await targetsOf(workspaceId);
    expect(new Set(targets.map((t) => t.socialAccountId)).size).toBe(2);
    const days = new Set(
      (await publicationsOf(workspaceId)).map((p) => p.scheduledAt.toISOString().slice(0, 10)),
    );
    expect(days.size).toBeGreaterThan(4);
  });

  it('replaces its own history rather than stacking a second one', async () => {
    const workspaceId = await workspaceWithAccounts();
    const first = await seedHistory(db, workspaceId, { weeks: 3, perWeek: 3, now });
    const second = await seedHistory(db, workspaceId, { weeks: 3, perWeek: 3, now });

    expect(second.publications).toBe(first.publications);
    expect(await publicationsOf(workspaceId)).toHaveLength(second.publications);
  });

  it('clears only what it wrote, never a real post', async () => {
    const workspaceId = await workspaceWithAccounts();
    await seedHistory(db, workspaceId, { weeks: 2, perWeek: 2, now });
    // A real publication beside the seeded ones, with a platform id of its own.
    const [real] = await unwrap(db)
      .insert(publications)
      .values({ workspaceId, scheduledAt: now, timezone: 'Asia/Kolkata', body: { text: 'Real' } })
      .returning();
    const accounts = await targetsOf(workspaceId);
    await unwrap(db)
      .insert(postTargets)
      .values({
        workspaceId,
        publicationId: real?.id ?? '',
        socialAccountId: accounts[0]?.socialAccountId ?? '',
        status: 'published',
        body: { text: 'Real' },
        platformPostId: 'urn:li:share:12345',
      });

    await clearHistory(db, workspaceId);

    const left = await targetsOf(workspaceId);
    expect(left.map((t) => t.platformPostId)).toEqual(['urn:li:share:12345']);
  });

  it('refuses a workspace with nothing to have posted from', async () => {
    const workspaceId = await createTestWorkspace(db);
    await expect(seedHistory(db, workspaceId, { now })).rejects.toThrow(/no connected accounts/);
  });
});
