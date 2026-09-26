import { randomBytes } from 'node:crypto';
import { encryptSecret } from '@cgp/config';
import {
  createPublication,
  jobs,
  markPostTarget,
  markPublished,
  scoped,
  upsertSocialAccount,
  type Database,
} from '@cgp/db';
import { createTestDatabase, createTestWorkspace } from '@cgp/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MAX_PUBLISH_ATTEMPTS } from './retry';
import { syncCentre } from './sync';

const kek = randomBytes(32);

let db: Database;
beforeAll(async () => {
  db = await createTestDatabase();
});
afterAll(async () => {
  await db.close();
});

async function workspaceWithAccount(platform: 'instagram' | 'linkedin' = 'linkedin') {
  const workspaceId = await createTestWorkspace(db);
  const account = await upsertSocialAccount(db, {
    workspaceId,
    platform,
    externalId: `${platform}-1`,
    displayName: platform === 'instagram' ? '@brand' : 'A Person',
    scopes: [],
    tokenCiphertext: encryptSecret(kek, 'token'),
    tokenExpiresAt: null,
  });
  return { workspaceId, account };
}

async function post(workspaceId: string, accountId: string, text = 'A post') {
  const created = await createPublication(db, {
    workspaceId,
    timezone: 'Asia/Kolkata',
    body: { text },
    targets: [{ socialAccountId: accountId, body: { text } }],
  });
  if (!created.ok) throw new Error(created.reason);
  const [target] = created.targets;
  const [job] = created.jobs;
  if (!target || !job) throw new Error('nothing created');
  return { target, job };
}

describe('the sync centre (WP35)', () => {
  it('passes the platform’s words through exactly, however they were written', async () => {
    const { workspaceId, account } = await workspaceWithAccount();
    const { target } = await post(workspaceId, account.id);
    // A real platform message: its own wording, its own punctuation, its own line breaks.
    const verbatim =
      '(#100) The parameter ig_container_id is required.\nSee https://developers.facebook.com/docs/';
    await markPostTarget(db, target.id, 'failed', {
      code: 'HTTP_400',
      message: verbatim,
      category: 'terminal',
    });

    const view = await syncCentre(db, workspaceId);

    expect(view.stuck[0]?.error).toEqual({
      code: 'HTTP_400',
      message: verbatim,
      category: 'terminal',
    });
  });

  it('puts what needs a person first, and what is still moving second', async () => {
    const { workspaceId, account } = await workspaceWithAccount();
    const waiting = await post(workspaceId, account.id, 'Waiting');
    const broken = await post(workspaceId, account.id, 'Broken');
    const done = await post(workspaceId, account.id, 'Done');
    await markPostTarget(db, broken.target.id, 'reauth_required', {
      code: 'HTTP_401',
      message: 'expired',
      category: 'reauth',
    });
    await markPublished(db, done.target.id, 'post-1', 'https://example.test/p/1');

    const view = await syncCentre(db, workspaceId);

    expect(view.stuck.map((a) => a.text)).toEqual(['Broken']);
    expect(view.inFlight.map((a) => a.text)).toEqual(['Waiting']);
    expect(view.recent.map((a) => a.text)).toEqual(['Done']);
    expect(view.recent[0]?.permalink).toBe('https://example.test/p/1');
    // A target that is waiting has no error to show.
    expect(view.inFlight[0]?.error).toBeNull();
    expect(waiting.target.status).toBe('pending');
  });

  it('says when the worker is coming back, and counts the attempt', async () => {
    const { workspaceId, account } = await workspaceWithAccount();
    const { target, job } = await post(workspaceId, account.id);
    const soon = new Date(Date.now() + 5 * 60_000);
    await markPostTarget(db, target.id, 'retry_scheduled', {
      code: 'HTTP_503',
      message: 'try later',
      category: 'retriable',
    });
    // As a reschedule leaves the job: queued again, later, one attempt spent.
    await scoped(db, workspaceId).update(
      jobs,
      { status: 'QUEUED', runAt: soon, attemptCount: 1 },
      (t, op) => op.eq(t.id, job.id),
    );

    const [attempt] = (await syncCentre(db, workspaceId)).inFlight;

    expect(attempt?.nextAttemptAt).toBe(soon.toISOString());
    expect(attempt?.attempt).toBe(2);
    expect(attempt?.maxAttempts).toBe(MAX_PUBLISH_ATTEMPTS);
  });

  it('does not promise a retry that is not coming', async () => {
    const { workspaceId, account } = await workspaceWithAccount();
    const { target, job } = await post(workspaceId, account.id);
    await markPostTarget(db, target.id, 'failed', {
      code: 'HTTP_503',
      message: 'gave up',
      category: 'retriable',
    });
    // The job ended: the attempts are spent, whatever time is still on the row.
    await scoped(db, workspaceId).update(jobs, { status: 'FAILED' }, (t, op) =>
      op.eq(t.id, job.id),
    );

    expect((await syncCentre(db, workspaceId)).stuck[0]?.nextAttemptAt).toBeNull();
  });

  it('never promises a retry for a target that has given up, whatever the job row says', async () => {
    const { workspaceId, account } = await workspaceWithAccount();
    const { target, job } = await post(workspaceId, account.id);
    await markPostTarget(db, target.id, 'failed', {
      code: 'HTTP_400',
      message: 'refused',
      category: 'terminal',
    });
    // A job still queued behind a target that has ended: swept, or failed by hand. The screen
    // must not tell someone their post is coming back when it is not.
    await scoped(db, workspaceId).update(
      jobs,
      { status: 'QUEUED', runAt: new Date(Date.now() + 60 * 60_000) },
      (t, op) => op.eq(t.id, job.id),
    );

    expect((await syncCentre(db, workspaceId)).stuck[0]?.nextAttemptAt).toBeNull();
  });

  it('never shows another workspace’s attempts', async () => {
    const mine = await workspaceWithAccount();
    const theirs = await workspaceWithAccount('instagram');
    await post(theirs.workspaceId, theirs.account.id, 'Theirs');

    const view = await syncCentre(db, mine.workspaceId);

    expect([...view.stuck, ...view.inFlight, ...view.recent]).toEqual([]);
  });
});
