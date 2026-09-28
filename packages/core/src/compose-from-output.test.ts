import { createFakeModeration, createImageAdapters, createMemoryStore } from '@cgp/adapters';
import { createLogger } from '@cgp/config';
import type { ModerationAdapter } from '@cgp/contracts';
import {
  outputs,
  publications,
  saveRendition,
  scoped,
  upsertSocialAccount,
  type Database,
} from '@cgp/db';
import {
  addTestProfile,
  createTestDatabase,
  createTestWorkspace,
  insertMeteringRates,
  seedTestCatalog,
} from '@cgp/db/testing';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { attachOutputToPost } from './compose-from-output';
import { instagramKey, startPublication } from './publishing';
import { generators } from './generators/definitions';
import { startGeneration } from './generate';
import { createImageHandlers } from './handlers/image';
import { processJob } from './process';
import type { Queues } from './queues';

const log = createLogger({ service: 'test', level: 'silent' });
const queues = {
  inference: { add: () => Promise.resolve() },
  render: { add: () => Promise.resolve() },
  publish: { add: () => Promise.resolve() },
} as unknown as Queues;

let db: Database;
let store: ReturnType<typeof createMemoryStore>;

beforeAll(async () => {
  db = await createTestDatabase();
  await insertMeteringRates(db);
  await seedTestCatalog(db);
  store = createMemoryStore();
});
afterAll(async () => {
  await db.close();
});

const deps = (moderation: ModerationAdapter = createFakeModeration()) => ({
  db,
  store,
  moderation,
  log,
});

/** A workspace holding one generated picture, made the way the Studio makes them. */
async function workspaceWithImage() {
  const workspaceId = await createTestWorkspace(db, { credits: 500 });
  await addTestProfile(db, workspaceId);
  const started = await startGeneration(
    {
      db,
      queues,
      log,
      registry: generators,
      compile: { rewriters: [] },
      moderation: createFakeModeration(),
    },
    {
      workspaceId,
      generatorKey: 'image',
      input: { intentText: 'A roastery at dawn', targetPlatform: 'instagram' },
    },
  );
  if (!started.ok) throw new Error(started.reason);
  const handlers = createImageHandlers({
    db,
    registry: generators,
    adapters: createImageAdapters('fake'),
    moderation: createFakeModeration(),
    store,
    costInr: () => 0,
    providerLabel: 'fake',
  });
  await processJob({ db, handlers, log }, { jobId: started.job.id, correlationId: 'c' });
  const [output] = await scoped(db, workspaceId).select(outputs);
  if (!output) throw new Error('no output');
  return { workspaceId, output };
}

describe('taking a Studio output into a post (WP33)', () => {
  it('copies the picture into the workspace’s uploads, with its Instagram frames', async () => {
    const { workspaceId, output } = await workspaceWithImage();

    const result = await attachOutputToPost(deps(), workspaceId, output.id);

    if (!result.ok) throw new Error(result.reason);
    expect(result.sourceOutputId).toBe(output.id);
    // The same shape a hand upload produces, so everything downstream is unchanged.
    expect(result.upload?.key).toMatch(new RegExp(`^${workspaceId}/uploads/`));
    expect(result.upload?.instagramUrl).toContain('.instagram.jpg');
    expect(result.upload?.instagramUrls.square).toContain('.instagram-square.jpg');
    // And the 4:5 copy really is 4:5, not the picture as generated.
    const meta = await sharp(
      Buffer.from(await store.get(instagramKey(result.upload?.key ?? ''))),
    ).metadata();
    expect((meta.width ?? 0) / (meta.height ?? 1)).toBeCloseTo(4 / 5, 2);
  });

  it('refuses a reel, because the publishers post pictures', async () => {
    const { workspaceId, output } = await workspaceWithImage();
    await scoped(db, workspaceId).update(outputs, { kind: 'video' }, (t, op) =>
      op.eq(t.id, output.id),
    );

    expect(await attachOutputToPost(deps(), workspaceId, output.id)).toEqual({
      ok: false,
      reason: 'not_postable',
      kind: 'video',
    });
  });

  it('checks the picture again, because what is posted is what is checked', async () => {
    const { workspaceId, output } = await workspaceWithImage();
    const refusing: ModerationAdapter = {
      key: 'refusing',
      checkText: () => Promise.resolve({ allowed: true, flagged: [] }),
      checkImage: () =>
        Promise.resolve({ allowed: false, flagged: [{ category: 'sexual' as const, score: 0.9 }] }),
    };

    expect(await attachOutputToPost(deps(refusing), workspaceId, output.id)).toMatchObject({
      ok: false,
      reason: 'blocked',
      category: 'sexual',
    });
  });

  it('never reaches another workspace’s output', async () => {
    const { output } = await workspaceWithImage();
    const other = await createTestWorkspace(db);

    expect(await attachOutputToPost(deps(), other, output.id)).toEqual({
      ok: false,
      reason: 'not_found',
    });
  });

  it('records which output the post came from, which is what the calendar reads', async () => {
    const { workspaceId, output } = await workspaceWithImage();
    const attached = await attachOutputToPost(deps(), workspaceId, output.id);
    if (!attached.ok) throw new Error(attached.reason);
    const accountId = (
      await upsertSocialAccount(db, {
        workspaceId,
        platform: 'instagram',
        externalId: 'ig-1',
        displayName: '@brand',
        scopes: [],
        tokenCiphertext: 'x',
        tokenExpiresAt: null,
      })
    ).id;

    const result = await startPublication(
      { db, queues, store, moderation: createFakeModeration(), log },
      {
        workspaceId,
        text: 'Straight from the Studio',
        media: { key: attached.upload?.key ?? '' },
        accountIds: [accountId],
        timezone: 'Asia/Kolkata',
        sourceOutputId: attached.sourceOutputId,
      },
    );

    if (!result.ok) throw new Error(result.reason);
    const [publication] = await scoped(db, workspaceId).select(publications);
    expect(publication?.sourceOutputId).toBe(output.id);
  });

  it('cuts the picture once and reuses it, rather than paying twice (WP32)', async () => {
    const { workspaceId, output } = await workspaceWithImage();
    let checks = 0;
    const counting: ModerationAdapter = {
      key: 'counting',
      checkText: () => Promise.resolve({ allowed: true, flagged: [] }),
      checkImage: () => {
        checks += 1;
        return Promise.resolve({ allowed: true, flagged: [] });
      },
    };

    const first = await attachOutputToPost(deps(counting), workspaceId, output.id);
    const second = await attachOutputToPost(deps(counting), workspaceId, output.id);

    if (!first.ok || !second.ok) throw new Error('attach failed');
    expect(first.cached).toBe(false);
    expect(second.cached).toBe(true);
    // The same file, so the same post: no second cut, no second stored copy, and no second
    // safety check, which is the one that costs money.
    expect(second.upload?.key).toBe(first.upload?.key);
    expect(second.upload?.instagramUrl).toBe(first.upload?.instagramUrl);
    expect(checks).toBe(1);
  });

  it('cuts again when the picture underneath has changed', async () => {
    const { workspaceId, output } = await workspaceWithImage();
    const first = await attachOutputToPost(deps(), workspaceId, output.id);
    if (!first.ok) throw new Error(first.reason);

    // A text layer drawn since: a different source, so the cached copy is the wrong picture.
    await store.put(
      `${workspaceId}/renditions/${output.id}.instagram.jpg`,
      await store.get(output.storageKey),
      'image/jpeg',
    );
    await saveRendition(db, workspaceId, {
      outputId: output.id,
      platform: 'instagram',
      spec: { drawn: true },
      storageKey: `${workspaceId}/renditions/${output.id}.instagram.jpg`,
    });

    const second = await attachOutputToPost(deps(), workspaceId, output.id);

    if (!second.ok) throw new Error(second.reason);
    expect(second.cached).toBe(false);
    expect(second.upload?.key).not.toBe(first.upload?.key);
  });
});
