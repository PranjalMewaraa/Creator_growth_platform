import { randomBytes } from 'node:crypto';
import { createFakeModeration, createMemoryStore } from '@cgp/adapters';
import { createLogger, encryptSecret } from '@cgp/config';
import type { QueuedJobData, TargetPlatform } from '@cgp/contracts';
import { jobs, postTargets, scoped, upsertSocialAccount, type Database } from '@cgp/db';
import { addTestProfile, createTestDatabase, createTestWorkspace } from '@cgp/db/testing';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { instagramKey, publicationView, startPublication, storeUpload } from './publishing';
import type { Queues } from './queues';

const log = createLogger({ service: 'test', level: 'silent' });
const kek = randomBytes(32);
let JPEG: Uint8Array;
let PNG: Uint8Array;

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
  // A wide landscape image, the case Instagram refuses as is.
  const wide = sharp({ create: { width: 1200, height: 400, channels: 3, background: '#e11d48' } });
  JPEG = new Uint8Array(await wide.clone().jpeg().toBuffer());
  PNG = new Uint8Array(await wide.clone().png().toBuffer());
});
afterAll(async () => {
  await db.close();
});

async function workspaceWith(platforms: TargetPlatform[]) {
  const workspaceId = await createTestWorkspace(db);
  const accountIds: string[] = [];
  for (const platform of platforms) {
    const row = await upsertSocialAccount(db, {
      workspaceId,
      platform,
      externalId: `${platform}-1`,
      displayName: platform,
      scopes: [],
      tokenCiphertext: encryptSecret(kek, 'token'),
      tokenExpiresAt: null,
    });
    accountIds.push(row.id);
  }
  return { workspaceId, accountIds };
}

describe('storeUpload', () => {
  // Built per test: db only exists once beforeAll has run.
  const deps = (store = createMemoryStore()) => ({
    db,
    store,
    moderation: createFakeModeration(),
    log,
  });

  it('stores a JPEG under the workspace prefix, trusting the bytes, not a claimed type', async () => {
    const workspaceId = await createTestWorkspace(db);
    const result = await storeUpload(deps(), workspaceId, JPEG);
    expect(result).toMatchObject({ ok: true, mimeType: 'image/jpeg', bytes: JPEG.length });
    expect(result.ok && result.key).toMatch(/^[\w-]+\/uploads\/[\w-]+\.jpg$/);
  });

  it('makes a 4:5 Instagram copy with bars in the brand colour, cropping nothing', async () => {
    const workspaceId = await createTestWorkspace(db);
    await addTestProfile(db, workspaceId); // brand colours start with #1F2937
    const store = createMemoryStore();
    const result = await storeUpload(deps(store), workspaceId, PNG);
    if (!result.ok) throw new Error(result.reason);

    const copy = await store.get(instagramKey(result.key));
    const image = sharp(copy);
    expect(await image.metadata()).toMatchObject({ format: 'jpeg', width: 1080, height: 1350 });
    // A 3:1 image is 1080x360 inside the frame: bars above and below, the image in between.
    const { data } = await image.raw().toBuffer({ resolveWithObject: true });
    const pixel = (x: number, y: number) => [
      ...data.subarray((y * 1080 + x) * 3, (y * 1080 + x) * 3 + 3),
    ];
    const near = (a: number[], b: number[]) => a.every((v, i) => Math.abs(v - (b[i] ?? 0)) <= 12);
    expect(near(pixel(540, 20), [0x1f, 0x29, 0x37])).toBe(true);
    expect(near(pixel(540, 1330), [0x1f, 0x29, 0x37])).toBe(true);
    expect(near(pixel(540, 675), [0xe1, 0x1d, 0x48])).toBe(true);
    expect(near(pixel(5, 675), [0xe1, 0x1d, 0x48])).toBe(true);
  });

  it('refuses anything that is not a JPEG or PNG, or cannot be decoded', async () => {
    const workspaceId = await createTestWorkspace(db);
    expect(
      await storeUpload(deps(), workspaceId, new TextEncoder().encode('<svg></svg>')),
    ).toMatchObject({ ok: false, reason: 'invalid_input' });
    expect(
      await storeUpload(deps(), workspaceId, new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2])),
    ).toMatchObject({ ok: false, reason: 'invalid_input' });
  });
});

describe('startPublication', () => {
  it('creates one target and one queued publish job per account', async () => {
    const { workspaceId, accountIds } = await workspaceWith(['instagram', 'linkedin']);
    const store = createMemoryStore();
    const upload = await storeUpload(
      { db, store, moderation: createFakeModeration(), log },
      workspaceId,
      JPEG,
    );
    if (!upload.ok) throw new Error(upload.reason);
    const { queues, added } = recordingQueues();

    const result = await startPublication(
      { db, queues, store, moderation: createFakeModeration(), log },
      {
        workspaceId,
        text: 'Now shipping #jaipur',
        media: { key: upload.key },
        accountIds,
        timezone: 'Asia/Kolkata',
      },
    );

    if (!result.ok) throw new Error(result.reason);
    const targets = await scoped(db, workspaceId).select(postTargets);
    expect(targets.map((t) => t.status)).toEqual(['pending', 'pending']);
    const bodyOf = (accountId: string | undefined) =>
      targets.find((t) => t.socialAccountId === accountId)?.body;
    // Instagram gets the 4:5 copy; LinkedIn the image as uploaded.
    expect(bodyOf(accountIds[0])).toEqual({
      text: 'Now shipping #jaipur',
      media: { kind: 'image', url: upload.instagramUrl, mimeType: 'image/jpeg' },
    });
    expect(bodyOf(accountIds[1])).toEqual({
      text: 'Now shipping #jaipur',
      media: { kind: 'image', url: upload.url, mimeType: 'image/jpeg' },
    });
    const queued = await scoped(db, workspaceId).select(jobs);
    expect(queued.map((j) => [j.jobClass, j.generatorKey, j.creditsHeld])).toEqual([
      ['publish', 'publish_target', 0],
      ['publish', 'publish_target', 0],
    ]);
    expect(added).toHaveLength(2);

    const view = await publicationView(db, workspaceId, result.publicationId);
    expect(view?.targets.map((t) => [t.platform, t.status])).toEqual([
      ['instagram', 'pending'],
      ['linkedin', 'pending'],
    ]);
  });

  it('checks each platform’s rules before creating anything', async () => {
    const { workspaceId, accountIds } = await workspaceWith(['instagram']);
    const store = createMemoryStore();
    const png = await storeUpload(
      { db, store, moderation: createFakeModeration(), log },
      workspaceId,
      PNG,
    );
    if (!png.ok) throw new Error(png.reason);

    const result = await startPublication(
      { db, ...recordingQueues(), store, moderation: createFakeModeration(), log },
      { workspaceId, text: 'x'.repeat(2201), media: { key: png.key }, accountIds, timezone: 'UTC' },
    );
    expect(result).toMatchObject({ ok: false, reason: 'invalid_input' });
    if (result.ok || result.reason !== 'invalid_input') return;
    // A PNG is fine now: Instagram gets the JPEG copy.
    expect(result.issues.map((i) => i.message)).toEqual(['Instagram allows 2200 characters']);

    const noImage = await startPublication(
      { db, ...recordingQueues(), store, moderation: createFakeModeration(), log },
      { workspaceId, text: 'words only', accountIds, timezone: 'UTC' },
    );
    expect(noImage).toMatchObject({
      ok: false,
      issues: [{ message: 'Instagram posts need an image' }],
    });
    expect(await scoped(db, workspaceId).select(postTargets)).toEqual([]);
  });

  it('sends Instagram the square copy when 1:1 is chosen', async () => {
    const { workspaceId, accountIds } = await workspaceWith(['instagram']);
    const store = createMemoryStore();
    const upload = await storeUpload(
      { db, store, moderation: createFakeModeration(), log },
      workspaceId,
      JPEG,
    );
    if (!upload.ok) throw new Error(upload.reason);
    expect(
      await sharp(await store.get(instagramKey(upload.key, 'square'))).metadata(),
    ).toMatchObject({ width: 1080, height: 1080 });

    const result = await startPublication(
      { db, ...recordingQueues(), store, moderation: createFakeModeration(), log },
      {
        workspaceId,
        text: 'Square',
        media: { key: upload.key },
        instagramFrame: 'square',
        accountIds,
        timezone: 'UTC',
      },
    );
    if (!result.ok) throw new Error(result.reason);
    const [target] = await scoped(db, workspaceId).select(postTargets);
    expect(target?.body).toMatchObject({ media: { url: upload.instagramUrls.square } });
  });

  it('allows a text only post to LinkedIn', async () => {
    const { workspaceId, accountIds } = await workspaceWith(['linkedin']);
    const result = await startPublication(
      {
        db,
        ...recordingQueues(),
        store: createMemoryStore(),
        moderation: createFakeModeration(),
        log,
      },
      { workspaceId, text: 'Just words', accountIds, timezone: 'UTC' },
    );
    expect(result.ok).toBe(true);
  });

  it('refuses media from another workspace and accounts it does not own', async () => {
    const mine = await workspaceWith(['linkedin']);
    const theirs = await workspaceWith(['linkedin']);
    const deps = {
      db,
      ...recordingQueues(),
      store: createMemoryStore(),
      moderation: createFakeModeration(),
      log,
    };

    expect(
      await startPublication(deps, {
        workspaceId: mine.workspaceId,
        text: 'x',
        accountIds: theirs.accountIds,
        timezone: 'UTC',
      }),
    ).toEqual({ ok: false, reason: 'account_not_found' });
    expect(
      await startPublication(deps, {
        workspaceId: mine.workspaceId,
        text: 'x',
        media: { key: `${theirs.workspaceId}/uploads/abc.jpg` },
        accountIds: mine.accountIds,
        timezone: 'UTC',
      }),
    ).toMatchObject({ ok: false, reason: 'invalid_input' });
    expect(
      await startPublication(deps, {
        workspaceId: mine.workspaceId,
        text: 'x',
        accountIds: ['not-a-uuid'],
        timezone: 'UTC',
      }),
    ).toEqual({ ok: false, reason: 'account_not_found' });
  });

  it('refuses text moderation blocks, with the category', async () => {
    const { workspaceId, accountIds } = await workspaceWith(['linkedin']);
    const result = await startPublication(
      {
        db,
        ...recordingQueues(),
        store: createMemoryStore(),
        moderation: createFakeModeration(),
        log,
      },
      { workspaceId, text: 'FAKE_BLOCK:hate something', accountIds, timezone: 'UTC' },
    );
    expect(result).toEqual({ ok: false, reason: 'blocked', category: 'hate' });
    expect(await scoped(db, workspaceId).select(postTargets)).toEqual([]);
  });
});

describe('scheduling a post (WP31)', () => {
  const deps = (queues: Queues) => ({
    db,
    queues,
    store: createMemoryStore(),
    moderation: createFakeModeration(),
    log,
  });

  it('keeps a post for later out of the queue, with the time on the job', async () => {
    const { workspaceId, accountIds } = await workspaceWith(['linkedin']);
    const { queues, added } = recordingQueues();
    const at = new Date(Date.now() + 3 * 60 * 60_000);

    const result = await startPublication(deps(queues), {
      workspaceId,
      text: 'Thursday morning, then.',
      accountIds,
      timezone: 'Asia/Kolkata',
      scheduledAt: at,
    });

    if (!result.ok) throw new Error(result.reason);
    // The one thing a schedule must not do is publish now.
    expect(added).toHaveLength(0);
    expect(result.scheduledAt).toEqual(at);
    const [job] = await scoped(db, workspaceId).select(jobs);
    expect(job?.status).toBe('QUEUED');
    expect(job?.runAt.toISOString()).toBe(at.toISOString());
    const view = await publicationView(db, workspaceId, result.publicationId);
    expect(view?.scheduledAt).toBe(at.toISOString());
    expect(view?.targets.map((t) => t.status)).toEqual(['pending']);
  });

  it('queues a post for right now as it always did', async () => {
    const { workspaceId, accountIds } = await workspaceWith(['linkedin']);
    const { queues, added } = recordingQueues();

    const result = await startPublication(deps(queues), {
      workspaceId,
      text: 'Out it goes.',
      accountIds,
      timezone: 'Asia/Kolkata',
    });

    if (!result.ok) throw new Error(result.reason);
    expect(added).toHaveLength(1);
    expect(result.scheduledAt).toBeUndefined();
  });

  it('refuses a time that has gone by, or one a year out', async () => {
    const { workspaceId, accountIds } = await workspaceWith(['linkedin']);
    const { queues } = recordingQueues();
    const post = (scheduledAt: Date) =>
      startPublication(deps(queues), {
        workspaceId,
        text: 'When?',
        accountIds,
        timezone: 'Asia/Kolkata',
        scheduledAt,
      });

    expect(await post(new Date(Date.now() - 10 * 60_000))).toMatchObject({
      ok: false,
      reason: 'invalid_input',
      issues: [{ path: 'scheduledAt', message: 'Pick a time in the future' }],
    });
    expect(await post(new Date(Date.now() + 400 * 24 * 60 * 60_000))).toMatchObject({
      ok: false,
      reason: 'invalid_input',
    });
    // A clock a few seconds behind the server's is not a mistake.
    expect(await post(new Date(Date.now() - 5_000))).toMatchObject({ ok: true });
  });
});
