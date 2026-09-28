import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Logger } from '@cgp/config';
import type { TargetPlatform } from '@cgp/contracts';
import { upsertSocialAccount, type Database, type SocialAccountRow } from '@cgp/db';
import type { ConnectedAccount, OAuthApp, OAuthProvider } from '@cgp/adapters';

/**
 * Connecting an account (WP28, S-03). The engine's half of the authorisation code flow: it
 * makes the state that ties a callback to the person who started it, and it writes the token
 * down encrypted. The provider's half lives in the adapters.
 *
 * A person has to be at the keyboard in the middle of this. That is what consent is.
 */

/** Long enough that a connect survives reading the permissions, short enough to expire. */
export const STATE_TTL_MS = 10 * 60_000;

export interface ConnectState {
  workspaceId: string;
  platform: TargetPlatform;
  /** Unguessable, and the whole reason the callback cannot be forged. */
  nonce: string;
  issuedAt: number;
}

/**
 * The state parameter, signed. It travels to the platform and back through the address bar,
 * so it is signed rather than trusted: a callback carrying a state this server did not issue
 * is someone else's, and is refused.
 */
export function signState(secret: string, state: ConnectState): string {
  const payload = Buffer.from(JSON.stringify(state)).toString('base64url');
  return `${payload}.${hmac(secret, payload)}`;
}

function hmac(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

export type StateCheck =
  | { ok: true; state: ConnectState }
  | { ok: false; reason: 'malformed' | 'bad_signature' | 'expired' | 'mismatch' };

/** Opens a signed state, refusing anything this server did not issue, recently, for this platform. */
export function readState(
  secret: string,
  signed: string,
  expected: { platform: TargetPlatform; now?: number },
): StateCheck {
  const [payload, signature] = signed.split('.');
  if (!payload || !signature) return { ok: false, reason: 'malformed' };

  const want = Buffer.from(hmac(secret, payload));
  const got = Buffer.from(signature);
  // Constant time, so the comparison does not leak the signature a byte at a time.
  if (want.length !== got.length || !timingSafeEqual(want, got)) {
    return { ok: false, reason: 'bad_signature' };
  }

  let state: ConnectState;
  try {
    state = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as ConnectState;
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (typeof state.workspaceId !== 'string' || typeof state.nonce !== 'string') {
    return { ok: false, reason: 'malformed' };
  }
  const now = expected.now ?? Date.now();
  if (!(state.issuedAt > 0) || now - state.issuedAt > STATE_TTL_MS) {
    return { ok: false, reason: 'expired' };
  }
  // The callback path says which platform answered; the state says which one was asked.
  if (state.platform !== expected.platform) return { ok: false, reason: 'mismatch' };
  return { ok: true, state };
}

export interface BeginConnect {
  secret: string;
  provider: OAuthProvider;
  app: OAuthApp;
  redirectUri: string;
  workspaceId: string;
}

/** Where to send the person, and the state to remember while they are gone. */
export function beginConnect(options: BeginConnect): { url: string; state: string } {
  const state = signState(options.secret, {
    workspaceId: options.workspaceId,
    platform: options.provider.platform,
    nonce: randomBytes(16).toString('base64url'),
    issuedAt: Date.now(),
  });
  return {
    url: options.provider.authorizeUrl({
      app: options.app,
      redirectUri: options.redirectUri,
      state,
    }),
    state,
  };
}

export type CompleteConnectResult =
  | { ok: true; account: SocialAccountRow; connected: ConnectedAccount }
  | { ok: false; reason: 'bad_state'; detail: string }
  | { ok: false; reason: 'refused'; message: string }
  | { ok: false; reason: 'exchange_failed'; message: string };

export interface CompleteConnect {
  db: Database;
  log: Logger;
  secret: string;
  provider: OAuthProvider;
  app: OAuthApp;
  redirectUri: string;
  /** Seals the token with the workspace key (D11). The clear token never reaches the database. */
  encryptToken: (token: string) => string;
}

/**
 * The other side of the round trip: check the state, trade the code for a token, write the
 * account down. Connecting the same account again refreshes the token rather than making a
 * second row, which is what the identity index is for.
 */
export async function completeConnect(
  deps: CompleteConnect,
  params: { code?: string | null; state?: string | null; error?: string | null },
): Promise<CompleteConnectResult> {
  // The person said no, or the platform refused before any code existed.
  if (params.error) return { ok: false, reason: 'refused', message: params.error };
  if (!params.code || !params.state) return { ok: false, reason: 'bad_state', detail: 'malformed' };

  const check = readState(deps.secret, params.state, { platform: deps.provider.platform });
  if (!check.ok) {
    deps.log.warn({ reason: check.reason }, 'connect callback refused');
    return { ok: false, reason: 'bad_state', detail: check.reason };
  }

  let connected: ConnectedAccount;
  try {
    connected = await deps.provider.exchange({
      app: deps.app,
      redirectUri: deps.redirectUri,
      code: params.code,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    deps.log.error({ err, platform: deps.provider.platform }, 'token exchange failed');
    return { ok: false, reason: 'exchange_failed', message };
  }
  if (!connected.externalId) {
    return { ok: false, reason: 'exchange_failed', message: 'The platform gave no account id' };
  }

  const account = await upsertSocialAccount(deps.db, {
    workspaceId: check.state.workspaceId,
    platform: connected.platform,
    externalId: connected.externalId,
    displayName: connected.displayName,
    scopes: connected.scopes,
    tokenCiphertext: deps.encryptToken(connected.accessToken),
    tokenExpiresAt: connected.expiresAt,
  });
  deps.log.info(
    { platform: connected.platform, accountId: account.id, expiresAt: connected.expiresAt },
    'account connected',
  );
  return { ok: true, account, connected };
}
