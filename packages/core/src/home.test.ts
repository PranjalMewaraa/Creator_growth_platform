import { randomBytes } from 'node:crypto';
import { encryptSecret } from '@cgp/config';
import { createPublication, markPostTarget, upsertSocialAccount, type Database } from '@cgp/db';
import { createTestDatabase, createTestWorkspace } from '@cgp/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EXPIRY_WARNING_DAYS, homeDigest, startOfDayIn } from './home';

const kek = randomBytes(32);
const IST = 'Asia/Kolkata';

let db: Database;
beforeAll(async () => {
  db = await createTestDatabase();
});
afterAll(async () => {
  await db.close();
});

async function workspaceWith(tokenExpiresAt: Date | null = null) {
  const workspaceId = await createTestWorkspace(db);
  const account = await upsertSocialAccount(db, {
    workspaceId,
    platform: 'linkedin',
    externalId: 'member-1',
    displayName: 'A Person',
    scopes: ['w_member_social'],
    tokenCiphertext: encryptSecret(kek, 'token'),
    tokenExpiresAt,
  });
  return { workspaceId, account };
}

async function schedule(workspaceId: string, accountId: string, at: Date, text: string) {
  const created = await createPublication(db, {
    workspaceId,
    timezone: IST,
    scheduledAt: at,
    body: { text },
    targets: [{ socialAccountId: accountId, body: { text } }],
  });
  if (!created.ok) throw new Error(created.reason);
  return created;
}

describe('the workspace day (S-04)', () => {
  it('starts at midnight where the workspace is, not where the server is', () => {
    // Half past six in the evening UTC is already the next day in Jaipur.
    const at = new Date('2026-09-28T18:30:00.000Z');
    expect(startOfDayIn(IST, at).toISOString()).toBe('2026-09-28T18:30:00.000Z');
    expect(startOfDayIn('UTC', at).toISOString()).toBe('2026-09-28T00:00:00.000Z');
  });
});

describe('the home digest (S-04)', () => {
  const now = new Date('2026-09-28T09:00:00.000Z'); // 14:30 in Jaipur

  it('lays the next seven days out and puts each post on its own day', async () => {
    const { workspaceId, account } = await workspaceWith();
    // Later today, and three days out, both in the workspace's own clock.
    await schedule(workspaceId, account.id, new Date('2026-09-28T13:00:00.000Z'), 'Today');
    await schedule(workspaceId, account.id, new Date('2026-10-01T05:00:00.000Z'), 'Thursday');
    // Next week: outside the window, so it is somebody else's problem today.
    await schedule(workspaceId, account.id, new Date('2026-10-20T05:00:00.000Z'), 'Later');

    const digest = await homeDigest(db, workspaceId, IST, { now });

    expect(digest.days).toHaveLength(7);
    expect(digest.days[0]?.isToday).toBe(true);
    expect(digest.days[0]?.posts.map((p) => p.text)).toEqual(['Today']);
    expect(digest.days[3]?.posts.map((p) => p.text)).toEqual(['Thursday']);
    expect(digest.scheduled).toBe(2);
    expect(digest.emptyDays).toBe(5);
  });

  it('counts a post just after midnight as that day, in the workspace’s clock', async () => {
    const { workspaceId, account } = await workspaceWith();
    // 00:30 on the 30th in Jaipur is still the 29th in UTC.
    await schedule(workspaceId, account.id, new Date('2026-09-29T19:00:00.000Z'), 'Past midnight');

    const digest = await homeDigest(db, workspaceId, IST, { now });

    expect(digest.days[2]?.posts.map((p) => p.text)).toEqual(['Past midnight']);
    expect(digest.days[1]?.posts).toEqual([]);
  });

  it('surfaces what nothing will fix on its own, and leaves the rest alone', async () => {
    const { workspaceId, account } = await workspaceWith();
    const stuck = await schedule(workspaceId, account.id, now, 'Broken');
    const fine = await schedule(workspaceId, account.id, now, 'Waiting');
    await markPostTarget(db, stuck.targets[0]?.id ?? '', 'reauth_required', {
      code: 'HTTP_401',
      message: 'expired',
      category: 'reauth',
    });

    const digest = await homeDigest(db, workspaceId, IST, { now });

    expect(digest.needsAttention.map((a) => a.text)).toEqual(['Broken']);
    expect(fine.targets[0]?.status).toBe('pending');
  });

  it('warns before a token dies, not after', async () => {
    const soon = await workspaceWith(new Date(now.getTime() + 3 * 86_400_000));
    const distant = await workspaceWith(
      new Date(now.getTime() + (EXPIRY_WARNING_DAYS + 20) * 86_400_000),
    );

    const near = (await homeDigest(db, soon.workspaceId, IST, { now })).accounts.find(
      (a) => a.platform === 'linkedin',
    );
    const far = (await homeDigest(db, distant.workspaceId, IST, { now })).accounts.find(
      (a) => a.platform === 'linkedin',
    );

    expect(near).toMatchObject({ needsAttention: true, expiresInDays: 3 });
    expect(far?.needsAttention).toBe(false);
  });

  it('does not call a platform that was never connected a problem', async () => {
    const { workspaceId } = await workspaceWith();
    const digest = await homeDigest(db, workspaceId, IST, { now });
    const instagram = digest.accounts.find((a) => a.platform === 'instagram');
    expect(instagram).toMatchObject({ connected: false, needsAttention: false });
  });
});
