import { randomBytes } from 'node:crypto';
import { createLogger, encryptSecret } from '@cgp/config';
import type { PostMetrics, Publisher, TargetPlatform } from '@cgp/contracts';
import { createPublication, markPublished, upsertSocialAccount, type Database } from '@cgp/db';
import { createTestDatabase, createTestWorkspace } from '@cgp/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { engagementOf, insights, median } from './insights';

const log = createLogger({ service: 'test', level: 'silent' });
const kek = randomBytes(32);

let db: Database;
beforeAll(async () => {
  db = await createTestDatabase();
});
afterAll(async () => {
  await db.close();
});

/** A publisher that reports whatever each post id was given, and counts the asking. */
function reporting(byPostId: Record<string, PostMetrics>) {
  const asked: string[] = [];
  const publisher = {
    platform: 'linkedin',
    prepare: () => Promise.reject(new Error('not used')),
    check: () => Promise.reject(new Error('not used')),
    publish: () => Promise.reject(new Error('not used')),
    metrics: (_account: unknown, platformPostId: string) => {
      asked.push(platformPostId);
      return Promise.resolve(byPostId[platformPostId] ?? { fetchedAt: '2026-09-28T00:00:00.000Z' });
    },
  } as unknown as Publisher;
  return { asked, publishers: { instagram: publisher, linkedin: publisher } };
}

const deps = (publishers: Record<TargetPlatform, Publisher>) => ({
  db,
  publishers,
  decryptToken: () => 'token',
  log,
});

async function workspaceWithPosts(posts: Array<{ text: string; postId: string }>) {
  const workspaceId = await createTestWorkspace(db);
  const account = await upsertSocialAccount(db, {
    workspaceId,
    platform: 'linkedin',
    externalId: 'member-1',
    displayName: 'A Person',
    scopes: [],
    tokenCiphertext: encryptSecret(kek, 'token'),
    tokenExpiresAt: null,
  });
  for (const { text, postId } of posts) {
    const created = await createPublication(db, {
      workspaceId,
      timezone: 'Asia/Kolkata',
      body: { text },
      targets: [{ socialAccountId: account.id, body: { text } }],
    });
    if (!created.ok) throw new Error(created.reason);
    await markPublished(db, created.targets[0]?.id ?? '', postId, `https://li/p/${postId}`);
  }
  return workspaceId;
}

describe('engagement', () => {
  it('adds up only what the platform reported', () => {
    expect(engagementOf({ fetchedAt: 'x', likes: 10, comments: 2, saves: 3 })).toBe(15);
  });

  it('is absent, not zero, when the platform reported nothing', () => {
    // The difference matters: "nobody engaged" and "the platform did not say" are not the
    // same claim, and only one of them is ours to make.
    expect(engagementOf({ fetchedAt: 'x' })).toBeNull();
    expect(engagementOf({ fetchedAt: 'x', reach: 500 })).toBeNull();
    expect(engagementOf({ fetchedAt: 'x', likes: 0 })).toBe(0);
  });

  it('takes a median, including across an even number of posts', () => {
    expect(median([5, 1, 9])).toBe(5);
    expect(median([1, 2, 3, 10])).toBe(2.5);
    expect(median([])).toBe(0);
  });
});

describe('insights (S-21)', () => {
  it('ranks each post against this workspace’s own median', async () => {
    const workspaceId = await workspaceWithPosts([
      { text: 'Quiet', postId: 'p1' },
      { text: 'Usual', postId: 'p2' },
      { text: 'Loud', postId: 'p3' },
    ]);
    const { publishers } = reporting({
      p1: { fetchedAt: 'x', likes: 1 },
      p2: { fetchedAt: 'x', likes: 10 },
      p3: { fetchedAt: 'x', likes: 40 },
    });

    const view = await insights(deps(publishers), workspaceId);

    const by = (text: string) => view.posts.find((post) => post.text === text);
    expect(by('Loud')?.standing).toBe('above');
    expect(by('Usual')?.standing).toBe('typical');
    expect(by('Quiet')?.standing).toBe('below');
    expect(view.baselines).toEqual([{ platform: 'linkedin', median: 10, posts: 3 }]);
  });

  it('does not rank one post against itself', async () => {
    const workspaceId = await workspaceWithPosts([{ text: 'The first', postId: 'p1' }]);
    const { publishers } = reporting({ p1: { fetchedAt: 'x', likes: 7 } });

    const view = await insights(deps(publishers), workspaceId);

    // One post is a number, not a baseline, and calling it "above usual" would be nonsense.
    expect(view.posts[0]?.engagement).toBe(7);
    expect(view.posts[0]?.standing).toBeNull();
  });

  it('asks only about posts that actually went out', async () => {
    const workspaceId = await workspaceWithPosts([{ text: 'Published', postId: 'p1' }]);
    // A second publication left unpublished: it has no platform post id to ask about.
    const account = await upsertSocialAccount(db, {
      workspaceId,
      platform: 'linkedin',
      externalId: 'member-1',
      displayName: 'A Person',
      scopes: [],
      tokenCiphertext: encryptSecret(kek, 'token'),
      tokenExpiresAt: null,
    });
    await createPublication(db, {
      workspaceId,
      timezone: 'Asia/Kolkata',
      body: { text: 'Never sent' },
      targets: [{ socialAccountId: account.id, body: { text: 'Never sent' } }],
    });
    const { publishers, asked } = reporting({ p1: { fetchedAt: 'x', likes: 1 } });

    const view = await insights(deps(publishers), workspaceId);

    expect(asked).toEqual(['p1']);
    expect(view.posts.map((post) => post.text)).toEqual(['Published']);
  });

  it('keeps going when a platform will not answer about one post', async () => {
    const workspaceId = await workspaceWithPosts([
      { text: 'Answers', postId: 'p1' },
      { text: 'Refuses', postId: 'p2' },
    ]);
    const publisher = {
      metrics: (_a: unknown, id: string) =>
        id === 'p2'
          ? Promise.reject(new Error('no insights for this media'))
          : Promise.resolve({ fetchedAt: 'x', likes: 3 }),
    } as unknown as Publisher;

    const view = await insights(deps({ instagram: publisher, linkedin: publisher }), workspaceId);

    expect(view.posts).toHaveLength(2);
    expect(view.posts.find((p) => p.text === 'Answers')?.engagement).toBe(3);
    expect(view.posts.find((p) => p.text === 'Refuses')?.engagement).toBeNull();
  });

  it('never shows another workspace’s posts', async () => {
    const mine = await workspaceWithPosts([]);
    await workspaceWithPosts([{ text: 'Theirs', postId: 'p9' }]);
    const { publishers } = reporting({});

    expect((await insights(deps(publishers), mine)).posts).toEqual([]);
  });
});
