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
import { MAX_PUBLISH_ATTEMPTS } from '../retry';
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

function handlerWith(publisher: Publisher, options: { now?: Date } = {}) {
  return createPublishHandler({
    db,
    publishers: { linkedin: publisher, instagram: publisher },
    // The worker decrypts with TOKEN_ENCRYPTION_KEY; here the test key.
    decryptToken: (ciphertext) => decryptSecret(kek, ciphertext),
    pollMs: 1,
    maxProcessingMs: 50,
    ...(options.now ? { now: () => options.now as Date } : {}),
    // No jitter: a backoff under test is a number, not a range.
    random: () => 0.5,
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

describe('automatic retries (WP31)', () => {
  const now = new Date('2026-09-26T10:00:00.000Z');

  /** The job row as it stands, which is where the attempt count and the next time live. */
  async function jobOf(workspaceId: string, jobId: string) {
    const [row] = await scoped(db, workspaceId).select(jobs, {
      where: (t, op) => op.eq(t.id, jobId),
    });
    if (!row) throw new Error('no job');
    return row;
  }

  it('brings a retriable failure back later, holding nothing against the workspace', async () => {
    const { workspaceId, job } = await setUp();
    const wobble = stubPublisher({
      publish: () =>
        Promise.reject(
          new AdapterError({ code: 'HTTP_503', message: 'later', category: 'retriable' }),
        ),
    });

    const result = await processJob(
      { db, handlers: { publish_target: handlerWith(wobble.publisher, { now }) }, log },
      { jobId: job.id, correlationId: 'c' },
    );

    // Not refunded and not failed: the work has not happened yet, it is only waiting.
    expect(result).toBe('retrying');
    const after = await jobOf(workspaceId, job.id);
    expect(after.status).toBe('QUEUED');
    expect(after.attemptCount).toBe(1);
    // Half a minute, the first step of the backoff.
    expect(after.runAt.toISOString()).toBe('2026-09-26T10:00:30.000Z');
    expect(await targetOf(workspaceId)).toMatchObject({
      status: 'retry_scheduled',
      lastError: { code: 'HTTP_503', category: 'retriable' },
    });
  });

  it('waits far longer when the platform says slow down', async () => {
    const { workspaceId, job } = await setUp();
    const limited = stubPublisher({
      publish: () =>
        Promise.reject(new AdapterError({ code: 'HTTP_429', message: 'slow', category: 'quota' })),
    });

    await processJob(
      { db, handlers: { publish_target: handlerWith(limited.publisher, { now }) }, log },
      { jobId: job.id, correlationId: 'c' },
    );

    const after = await jobOf(workspaceId, job.id);
    expect(after.runAt.toISOString()).toBe('2026-09-26T10:15:00.000Z');
    expect(await targetOf(workspaceId)).toMatchObject({ status: 'quota_wait' });
  });

  it('gives up after the last attempt, keeping the platform’s own last words', async () => {
    const { workspaceId, job } = await setUp();
    const broken = stubPublisher({
      publish: () =>
        Promise.reject(
          new AdapterError({ code: 'HTTP_503', message: 'later', category: 'retriable' }),
        ),
    });
    const handlers = { publish_target: handlerWith(broken.publisher, { now }) };

    // Five attempts in all: four that come back, and a fifth that does not.
    const results = [];
    for (let i = 0; i < MAX_PUBLISH_ATTEMPTS; i++) {
      results.push(await processJob({ db, handlers, log }, { jobId: job.id, correlationId: 'c' }));
    }

    expect(results).toEqual(['retrying', 'retrying', 'retrying', 'retrying', 'refunded']);
    expect(broken.counts.publish).toBe(MAX_PUBLISH_ATTEMPTS);
    expect(await targetOf(workspaceId)).toMatchObject({
      status: 'failed',
      // The error stays as the platform gave it, category and all, so the Sync centre can
      // say this was a retriable failure we stopped retrying rather than a refusal.
      lastError: { code: 'HTTP_503', message: 'later', category: 'retriable' },
    });
    expect((await jobOf(workspaceId, job.id)).status).toBe('FAILED');
  });

  it('never brings back a refusal or an expired token, whatever the attempt count', async () => {
    const refused = await setUp();
    const policy = stubPublisher({
      publish: () =>
        Promise.reject(
          new AdapterError({ code: 'HTTP_400', message: 'not allowed', category: 'terminal' }),
        ),
    });
    expect(
      await processJob(
        { db, handlers: { publish_target: handlerWith(policy.publisher, { now }) }, log },
        { jobId: refused.job.id, correlationId: 'c' },
      ),
    ).toBe('refunded');
    expect(await targetOf(refused.workspaceId)).toMatchObject({ status: 'failed' });

    const expired = await setUp();
    const reauth = stubPublisher({
      check: () =>
        Promise.reject(
          new AdapterError({ code: 'HTTP_401', message: 'expired', category: 'reauth' }),
        ),
    });
    expect(
      await processJob(
        { db, handlers: { publish_target: handlerWith(reauth.publisher, { now }) }, log },
        { jobId: expired.job.id, correlationId: 'c' },
      ),
    ).toBe('refunded');
    expect(await targetOf(expired.workspaceId)).toMatchObject({ status: 'reauth_required' });
  });

  it('claims a target that is waiting out a quota, so the retry can actually run', async () => {
    const { workspaceId, job } = await setUp();
    const flaky = stubPublisher({
      publish: () =>
        Promise.reject(new AdapterError({ code: 'HTTP_429', message: 'slow', category: 'quota' })),
    });
    await processJob(
      { db, handlers: { publish_target: handlerWith(flaky.publisher, { now }) }, log },
      { jobId: job.id, correlationId: 'c' },
    );
    expect(await targetOf(workspaceId)).toMatchObject({ status: 'quota_wait' });

    // The platform recovers; the next attempt must get past the claim.
    const recovered = stubPublisher();
    expect(
      await processJob(
        { db, handlers: { publish_target: handlerWith(recovered.publisher, { now }) }, log },
        { jobId: job.id, correlationId: 'c' },
      ),
    ).toBe('settled');
    expect(await targetOf(workspaceId)).toMatchObject({ status: 'published' });
  });
});
