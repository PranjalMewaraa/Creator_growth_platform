import { randomBytes } from 'node:crypto';
import { createLogger, decryptSecret, encryptSecret, parseEncryptionKey } from '@cgp/config';
import type { ConnectedAccount, OAuthProvider } from '@cgp/adapters';
import { scoped, socialAccounts, type Database } from '@cgp/db';
import { createTestDatabase, createTestWorkspace } from '@cgp/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { beginConnect, completeConnect, readState, signState, STATE_TTL_MS } from './connect';

const log = createLogger({ service: 'test', level: 'silent' });
const SECRET = 'a-secret-long-enough-to-sign-with-0123456789';
const kek = parseEncryptionKey(Buffer.from(randomBytes(32)).toString('base64url'));
const app = { clientId: 'id', clientSecret: 'shh' };

let db: Database;
beforeAll(async () => {
  db = await createTestDatabase();
});
afterAll(async () => {
  await db.close();
});

/** A provider that answers without a network, and counts what it was asked. */
function stubProvider(account?: Partial<ConnectedAccount>) {
  const calls: Array<{ code: string; redirectUri: string }> = [];
  const provider: OAuthProvider = {
    platform: 'linkedin',
    scopes: ['openid', 'profile', 'w_member_social'],
    authorizeUrl: ({ state, redirectUri }) =>
      `https://linkedin.test/authorize?state=${state}&redirect_uri=${redirectUri}`,
    exchange: ({ code, redirectUri }) => {
      calls.push({ code, redirectUri });
      return Promise.resolve({
        platform: 'linkedin',
        externalId: 'member-1',
        displayName: 'A Person',
        accessToken: 'the-token',
        expiresAt: new Date('2026-12-01T00:00:00.000Z'),
        scopes: ['openid', 'profile', 'w_member_social'],
        ...account,
      });
    },
  };
  return { provider, calls };
}

const deps = (provider: OAuthProvider) => ({
  db,
  log,
  secret: SECRET,
  provider,
  app,
  redirectUri: 'https://app.test/api/oauth/linkedin/callback',
  encryptToken: (token: string) => encryptSecret(kek, token),
});

describe('the connect state (WP28)', () => {
  const state = {
    workspaceId: 'w1',
    platform: 'linkedin' as const,
    nonce: 'n',
    issuedAt: Date.now(),
  };

  it('opens a state this server signed', () => {
    const check = readState(SECRET, signState(SECRET, state), { platform: 'linkedin' });
    expect(check.ok && check.state.workspaceId).toBe('w1');
  });

  it('refuses one signed with a different secret, which is the whole point of signing it', () => {
    const forged = signState('some-other-secret-entirely-0123456789', state);
    expect(readState(SECRET, forged, { platform: 'linkedin' })).toEqual({
      ok: false,
      reason: 'bad_signature',
    });
  });

  it('refuses a tampered payload, even one that still parses', () => {
    const signed = signState(SECRET, state);
    const [, signature] = signed.split('.');
    const swapped = Buffer.from(JSON.stringify({ ...state, workspaceId: 'someone-else' })).toString(
      'base64url',
    );
    expect(readState(SECRET, `${swapped}.${signature}`, { platform: 'linkedin' })).toEqual({
      ok: false,
      reason: 'bad_signature',
    });
  });

  it('refuses one that has gone stale', () => {
    const old = signState(SECRET, { ...state, issuedAt: Date.now() - STATE_TTL_MS - 1000 });
    expect(readState(SECRET, old, { platform: 'linkedin' })).toEqual({
      ok: false,
      reason: 'expired',
    });
  });

  it('refuses one answered by a platform it was not meant for', () => {
    const signed = signState(SECRET, state);
    expect(readState(SECRET, signed, { platform: 'instagram' })).toEqual({
      ok: false,
      reason: 'mismatch',
    });
  });

  it('gives every connect its own state', () => {
    const one = beginConnect({ ...deps(stubProvider().provider), workspaceId: 'w1' });
    const two = beginConnect({ ...deps(stubProvider().provider), workspaceId: 'w1' });
    expect(one.state).not.toBe(two.state);
    expect(one.url).toContain('state=');
  });
});

describe('completing a connect', () => {
  async function connect(workspaceId: string, provider: OAuthProvider) {
    const { state } = beginConnect({ ...deps(provider), workspaceId });
    return completeConnect(deps(provider), { code: 'the-code', state });
  }

  it('stores the account with the token encrypted, never in the clear', async () => {
    const workspaceId = await createTestWorkspace(db);
    const { provider, calls } = stubProvider();

    const result = await connect(workspaceId, provider);

    if (!result.ok) throw new Error(result.reason);
    expect(calls).toEqual([
      { code: 'the-code', redirectUri: 'https://app.test/api/oauth/linkedin/callback' },
    ]);
    const [row] = await scoped(db, workspaceId).select(socialAccounts);
    expect(row?.externalId).toBe('member-1');
    expect(row?.scopes).toEqual(['openid', 'profile', 'w_member_social']);
    expect(row?.tokenExpiresAt?.toISOString()).toBe('2026-12-01T00:00:00.000Z');
    // The token is in there, but not as anyone could read it.
    expect(row?.tokenCiphertext).not.toContain('the-token');
    expect(decryptSecret(kek, row?.tokenCiphertext ?? '')).toBe('the-token');
  });

  it('refreshes the same account rather than connecting it twice', async () => {
    const workspaceId = await createTestWorkspace(db);
    await connect(workspaceId, stubProvider().provider);
    await connect(workspaceId, stubProvider({ accessToken: 'a-newer-token' }).provider);

    const rows = await scoped(db, workspaceId).select(socialAccounts);
    expect(rows).toHaveLength(1);
    expect(decryptSecret(kek, rows[0]?.tokenCiphertext ?? '')).toBe('a-newer-token');
  });

  it('never trades a code for a token on a state it did not issue', async () => {
    const workspaceId = await createTestWorkspace(db);
    const { provider, calls } = stubProvider();
    const forged = signState('another-secret-entirely-0123456789', {
      workspaceId,
      platform: 'linkedin',
      nonce: 'n',
      issuedAt: Date.now(),
    });

    const result = await completeConnect(deps(provider), { code: 'the-code', state: forged });

    expect(result).toEqual({ ok: false, reason: 'bad_state', detail: 'bad_signature' });
    // The important part: the code was never sent anywhere.
    expect(calls).toEqual([]);
    expect(await scoped(db, workspaceId).select(socialAccounts)).toEqual([]);
  });

  it('says so plainly when the person cancels the permission screen', async () => {
    const { provider, calls } = stubProvider();
    const result = await completeConnect(deps(provider), { error: 'user_denied' });
    expect(result).toEqual({ ok: false, reason: 'refused', message: 'user_denied' });
    expect(calls).toEqual([]);
  });

  it('keeps the platform’s own words when the exchange fails', async () => {
    const failing: OAuthProvider = {
      ...stubProvider().provider,
      exchange: () => Promise.reject(new Error('This authorization code has expired.')),
    };
    const workspaceId = await createTestWorkspace(db);
    const { state } = beginConnect({ ...deps(failing), workspaceId });

    expect(await completeConnect(deps(failing), { code: 'stale', state })).toEqual({
      ok: false,
      reason: 'exchange_failed',
      message: 'This authorization code has expired.',
    });
  });
});
