import { createLogger, decryptSecret, encryptSecret } from '@cgp/config';
import {
  AdapterError,
  type PostContent,
  type PreparedState,
  type Publisher,
  type PublishedPost,
} from '@cgp/contracts';
import {
  createPublication,
  jobs,
  postTargets,
  scoped,
  upsertSocialAccount,
  type Database,
} from '@cgp/db';
import { createTestDatabase, createTestWorkspace } from '@cgp/db/testing';
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { processJob } from '../process';
import { createPublishHandler, PublishNotCompleted } from './publish';

const log = createLogger({ service: 'test', level: 'silent' });
const kek = randomBytes(32);

/** A publisher whose answers each test scripts, counting irreversible calls. */
function stubPublisher(
  overrides: {
    check?: () => Promise<PreparedState>;
    publish?: () => Promise<PublishedPost>;
  } = {},
) {
  const counts = { prepare: 0, publish: 0 };
  const tokens: string[] = [];
  const publisher: Publisher = {
    platform: 'linkedin',
    prepare: (account) => {
      counts.prepare++;
      tokens.push(account.accessToken);
      return Promise.resolve({ platform: 'linkedin', ref: 'draft-1' });
    },
    check: overrides.check ?? (() => Promise.resolve({ state: 'ready' })),
    publish: () => {
      counts.publish++;
      return (
        overrides.publish?.() ??
        Promise.resolve({ platformPostId: 'urn:li:share:1', permalink: 'https://li/p/1' })
      );
    },
    metrics: () => Promise.resolve({ fetchedAt: new Date().toISOString() }),
  };
  return { publisher, counts, tokens };
}

let db: Database;

beforeAll(async () => {
  db = await createTestDatabase();
});

afterAll(async () => {
  await db.close();
});

async function setUp(body: PostContent = { text: 'Hello' }) {
  const workspaceId = await createTestWorkspace(db);
  const account = await upsertSocialAccount(db, {
    workspaceId,
    platform: 'linkedin',
    externalId: 'member-1',
    displayName: 'Test member',
    scopes: ['w_member_social'],
    tokenCiphertext: encryptSecret(kek, 'secret-token'),
    tokenExpiresAt: null,
  });
  const created = await createPublication(db, {
    workspaceId,
    timezone: 'Asia/Kolkata',
    body: { ...body },
    targets: [{ socialAccountId: account.id, body: { ...body } }],
  });
  if (!created.ok) throw new Error(created.reason);
  const [job] = created.jobs;
  const [target] = created.targets;
  if (!job || !target) throw new Error('nothing created');
  return { workspaceId, job, target };
}

function handlerWith(publisher: Publisher) {
  return createPublishHandler({
    db,
    publishers: { linkedin: publisher, instagram: publisher },
    // The worker decrypts with TOKEN_ENCRYPTION_KEY; here the test key.
    decryptToken: (ciphertext) => decryptSecret(kek, ciphertext),
    pollMs: 1,
    maxProcessingMs: 50,
  });
}

async function targetOf(workspaceId: string) {
  const [row] = await scoped(db, workspaceId).select(postTargets);
  return row;
}

describe('publish handler (invariant 9)', () => {
  it('prepares, claims, publishes and records the post id with the decrypted token', async () => {
    const { workspaceId, job } = await setUp();
    const stub = stubPublisher();

    expect(
      await processJob(
        { db, handlers: { publish_target: handlerWith(stub.publisher) }, log },
        { jobId: job.id, correlationId: 'c' },
      ),
    ).toBe('settled');

    expect(await targetOf(workspaceId)).toMatchObject({
      status: 'published',
      platformPostId: 'urn:li:share:1',
      permalink: 'https://li/p/1',
      preparedRef: 'draft-1',
      attemptCount: 1,
    });
    expect(stub.tokens).toEqual(['secret-token']);
    const [row] = await scoped(db, workspaceId).select(jobs);
    expect(row?.status).toBe('COMPLETE');
  });

  it('never publishes a target twice, however often the job is delivered', async () => {
    const { workspaceId, job } = await setUp();
    const stub = stubPublisher();
    const handler = handlerWith(stub.publisher);
    const [row] = await scoped(db, workspaceId).select(jobs, {
      where: (t, op) => op.eq(t.id, job.id),
    });
    if (!row) throw new Error('no job');

    await handler(row, log);
    await handler(row, log);
    await Promise.all([handler(row, log), handler(row, log)]);
    expect(stub.counts.publish).toBe(1);
  });

  it('sends a target interrupted during the publish call to needs_verification, not a retry', async () => {
    const { workspaceId, job, target } = await setUp();
    // As a crash leaves it: claimed, publish started, no post id.
    await scoped(db, workspaceId).update(
      postTargets,
      { status: 'claimed', publishStartedAt: new Date(), preparedRef: 'draft-1' },
      (t, op) => op.eq(t.id, target.id),
    );
    const stub = stubPublisher();
    const [row] = await scoped(db, workspaceId).select(jobs, {
      where: (t, op) => op.eq(t.id, job.id),
    });
    if (!row) throw new Error('no job');

    await expect(handlerWith(stub.publisher)(row, log)).rejects.toBeInstanceOf(PublishNotCompleted);
    expect(stub.counts.publish).toBe(0);
    expect(await targetOf(workspaceId)).toMatchObject({ status: 'needs_verification' });
  });

  it('retries a target claimed but never sent, without preparing a new draft', async () => {
    const { workspaceId, job, target } = await setUp();
    await scoped(db, workspaceId).update(
      postTargets,
      { status: 'claimed', preparedRef: 'draft-1' },
      (t, op) => op.eq(t.id, target.id),
    );
    const stub = stubPublisher();
    const [row] = await scoped(db, workspaceId).select(jobs, {
      where: (t, op) => op.eq(t.id, job.id),
    });
    if (!row) throw new Error('no job');

    await handlerWith(stub.publisher)(row, log);
    expect(stub.counts).toEqual({ prepare: 0, publish: 1 });
    expect(await targetOf(workspaceId)).toMatchObject({ status: 'published' });
  });

  it('treats a definite refusal by category, and a lost answer as needs_verification', async () => {
    const refused = await setUp();
    const quota = stubPublisher({
      publish: () =>
        Promise.reject(new AdapterError({ code: 'HTTP_429', message: 'slow', category: 'quota' })),
    });
    await processJob(
      { db, handlers: { publish_target: handlerWith(quota.publisher) }, log },
      { jobId: refused.job.id, correlationId: 'c' },
    );
    expect(await targetOf(refused.workspaceId)).toMatchObject({
      status: 'quota_wait',
      publishStartedAt: null,
      lastError: { code: 'HTTP_429', category: 'quota' },
    });

    const lost = await setUp();
    const network = stubPublisher({
      publish: () =>
        Promise.reject(
          new AdapterError({ code: 'NETWORK', message: 'reset', category: 'retriable' }),
        ),
    });
    await processJob(
      { db, handlers: { publish_target: handlerWith(network.publisher) }, log },
      { jobId: lost.job.id, correlationId: 'c' },
    );
    expect(await targetOf(lost.workspaceId)).toMatchObject({ status: 'needs_verification' });
  });

  it('marks an expired token reauth_required before anything is claimed', async () => {
    const { workspaceId, job } = await setUp();
    const stub = stubPublisher({
      check: () =>
        Promise.reject(
          new AdapterError({ code: 'HTTP_401', message: 'expired', category: 'reauth' }),
        ),
    });
    const result = await processJob(
      { db, handlers: { publish_target: handlerWith(stub.publisher) }, log },
      { jobId: job.id, correlationId: 'c' },
    );
    expect(result).toBe('refunded');
    expect(await targetOf(workspaceId)).toMatchObject({
      status: 'reauth_required',
      attemptCount: 0,
      claimedAt: null,
    });
    expect(stub.counts.publish).toBe(0);
  });

  it('gives up on media still processing, as retry_scheduled', async () => {
    const { workspaceId, job } = await setUp();
    const stub = stubPublisher({ check: () => Promise.resolve({ state: 'processing' }) });
    await processJob(
      { db, handlers: { publish_target: handlerWith(stub.publisher) }, log },
      { jobId: job.id, correlationId: 'c' },
    );
    expect(await targetOf(workspaceId)).toMatchObject({
      status: 'retry_scheduled',
      lastError: { code: 'PROCESSING_TIMEOUT' },
    });
  });

  it('refuses a publication naming another workspace’s account', async () => {
    const mine = await setUp();
    const other = await createTestWorkspace(db);
    const [target] = await scoped(db, mine.workspaceId).select(postTargets);
    expect(
      await createPublication(db, {
        workspaceId: other,
        timezone: 'Asia/Kolkata',
        body: { text: 'x' },
        targets: [{ socialAccountId: target?.socialAccountId ?? '', body: { text: 'x' } }],
      }),
    ).toEqual({ ok: false, reason: 'account_not_found' });
  });
});
