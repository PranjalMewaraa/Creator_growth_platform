import { randomBytes } from 'node:crypto';
import { encryptSecret } from '@cgp/config';
import {
  createPublication,
  markPostTarget,
  markPublished,
  upsertSocialAccount,
  type Database,
} from '@cgp/db';
import { createTestDatabase, createTestWorkspace } from '@cgp/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { calendarWeek, renderStateFor } from './calendar';

const kek = randomBytes(32);

let db: Database;
beforeAll(async () => {
  db = await createTestDatabase();
});
afterAll(async () => {
  await db.close();
});

const MONDAY = new Date('2026-09-21T00:00:00.000Z');
const NEXT_MONDAY = new Date('2026-09-28T00:00:00.000Z');

async function workspaceWithAccounts() {
  const workspaceId = await createTestWorkspace(db);
  const accounts = [];
  for (const platform of ['instagram', 'linkedin'] as const) {
    accounts.push(
      await upsertSocialAccount(db, {
        workspaceId,
        platform,
        externalId: `${platform}-1`,
        displayName: platform === 'instagram' ? '@brand' : 'A Person',
        scopes: [],
        tokenCiphertext: encryptSecret(kek, 'token'),
        tokenExpiresAt: null,
      }),
    );
  }
  return { workspaceId, accounts };
}

async function schedule(
  workspaceId: string,
  accountIds: string[],
  scheduledAt: Date,
  text = 'A post',
) {
  const created = await createPublication(db, {
    workspaceId,
    timezone: 'Asia/Kolkata',
    scheduledAt,
    body: { text },
    targets: accountIds.map((socialAccountId) => ({ socialAccountId, body: { text } })),
  });
  if (!created.ok) throw new Error(created.reason);
  return created;
}

describe('the calendar week (WP34)', () => {
  it('returns the week’s posts in order, and nothing from the weeks either side', async () => {
    const { workspaceId, accounts } = await workspaceWithAccounts();
    const ids = accounts.map((a) => a.id);
    await schedule(workspaceId, ids, new Date('2026-09-23T09:00:00.000Z'), 'Wednesday');
    await schedule(workspaceId, ids, new Date('2026-09-22T09:00:00.000Z'), 'Tuesday');
    // The instant the week ends belongs to the next week, not this one.
    await schedule(workspaceId, ids, NEXT_MONDAY, 'Next Monday');
    await schedule(workspaceId, ids, new Date('2026-09-20T23:59:59.000Z'), 'Last Sunday');

    const week = await calendarWeek(db, workspaceId, MONDAY, NEXT_MONDAY);

    expect(week.map((p) => p.text)).toEqual(['Tuesday', 'Wednesday']);
  });

  it('carries a chip per target, so one post can succeed on one platform and fail on another', async () => {
    const { workspaceId, accounts } = await workspaceWithAccounts();
    const [instagram, linkedin] = accounts;
    if (!instagram || !linkedin) throw new Error('no accounts');
    const created = await schedule(
      workspaceId,
      [instagram.id, linkedin.id],
      new Date('2026-09-24T09:00:00.000Z'),
    );
    const [first, second] = created.targets;
    if (!first || !second) throw new Error('no targets');
    await markPublished(db, first.id, 'post-1', 'https://example.test/p/1');
    await markPostTarget(db, second.id, 'reauth_required', {
      code: 'HTTP_401',
      message: 'expired',
      category: 'reauth',
    });

    const [post] = await calendarWeek(db, workspaceId, MONDAY, NEXT_MONDAY);

    expect(post?.targets.map((t) => [t.platform, t.status, t.permalink])).toEqual([
      ['instagram', 'published', 'https://example.test/p/1'],
      ['linkedin', 'reauth_required', null],
    ]);
  });

  it('says nothing about rendering for a post written in the composer', async () => {
    const { workspaceId, accounts } = await workspaceWithAccounts();
    await schedule(workspaceId, [accounts[0]?.id ?? ''], new Date('2026-09-25T09:00:00.000Z'));

    const [post] = await calendarWeek(db, workspaceId, MONDAY, NEXT_MONDAY);

    // No source output, so there is no render to have a state.
    expect(post?.render).toBeNull();
  });

  it('never shows another workspace’s week', async () => {
    const mine = await workspaceWithAccounts();
    const theirs = await workspaceWithAccounts();
    await schedule(
      theirs.workspaceId,
      [theirs.accounts[0]?.id ?? ''],
      new Date('2026-09-24T09:00:00.000Z'),
    );

    expect(await calendarWeek(db, mine.workspaceId, MONDAY, NEXT_MONDAY)).toEqual([]);
  });

  it('says what is happening to the media a post is waiting on', () => {
    // Nothing sets a publication's source output yet: the Studio does not hand a render to
    // the composer. The join is in place for when it does, and this is the rule it feeds.
    expect(renderStateFor(null)).toBeNull();
    expect(renderStateFor('COMPLETE')).toBeNull();
    expect(renderStateFor('RUNNING')).toBe('rendering');
    expect(renderStateFor('QUEUED')).toBe('rendering');
    expect(renderStateFor('MODERATING')).toBe('rendering');
    expect(renderStateFor('FAILED')).toBe('failed');
    expect(renderStateFor('BLOCKED')).toBe('failed');
  });
});
