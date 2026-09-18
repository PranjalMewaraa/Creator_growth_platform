import { randomBytes } from 'node:crypto';
import { createFakeModeration, createMemoryStore } from '@cgp/adapters';
import { createLogger, encryptSecret } from '@cgp/config';
import type { QueuedJobData, TargetPlatform } from '@cgp/contracts';
import { jobs, postTargets, scoped, upsertSocialAccount, type Database } from '@cgp/db';
import { createTestDatabase, createTestWorkspace } from '@cgp/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { publicationView, startPublication, storeUpload } from './publishing';
import type { Queues } from './queues';

const log = createLogger({ service: 'test', level: 'silent' });
const kek = randomBytes(32);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);

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
  const deps = { store: createMemoryStore(), moderation: createFakeModeration(), log };

  it('stores a JPEG under the workspace prefix, trusting the bytes, not a claimed type', async () => {
    const result = await storeUpload(deps, 'ws-1', JPEG);
    expect(result).toMatchObject({ ok: true, mimeType: 'image/jpeg', bytes: JPEG.length });
    expect(result.ok && result.key).toMatch(/^ws-1\/uploads\/[\w-]+\.jpg$/);
  });

  it('refuses anything that is not a JPEG or PNG', async () => {
    const result = await storeUpload(deps, 'ws-1', new TextEncoder().encode('<svg></svg>'));
    expect(result).toMatchObject({ ok: false, reason: 'invalid_input' });
  });
});

describe('startPublication', () => {
  it('creates one target and one queued publish job per account', async () => {
    const { workspaceId, accountIds } = await workspaceWith(['instagram', 'linkedin']);
    const store = createMemoryStore();
    const upload = await storeUpload(
      { store, moderation: createFakeModeration(), log },
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
    expect(targets[0]?.body).toEqual({
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
      { store, moderation: createFakeModeration(), log },
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
    expect(result.issues.map((i) => i.message).sort()).toEqual([
      'Instagram allows 2200 characters',
      'Instagram needs a JPEG image',
    ]);
    expect(await scoped(db, workspaceId).select(postTargets)).toEqual([]);
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
