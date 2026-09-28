import type { TargetPlatform } from '@cgp/contracts';
import { AdapterError } from '@cgp/contracts';
import { normalizeError } from '../errors';

/**
 * Connecting an account (WP28, S-03). The authorisation code flow for both platforms, kept
 * here because everything below is provider shape: their URLs, their parameter names, their
 * answers. What leaves this file is one connected account, the same for either platform
 * (invariant 3).
 *
 * The flow is halves. `authorizeUrl` is where the person goes to say yes; nothing is exchanged
 * until they come back with a code. A person has to be at the keyboard for the middle: that is
 * the point of consent, and neither the plan nor this code pretends otherwise.
 */

export interface ConnectedAccount {
  platform: TargetPlatform;
  /** The platform's own id for the account. Identity, with workspace and platform. */
  externalId: string;
  displayName: string | null;
  accessToken: string;
  /** When the token dies, when the platform says. Null when it does not say (plan section 3). */
  expiresAt: Date | null;
  scopes: string[];
}

export interface OAuthApp {
  clientId: string;
  clientSecret: string;
}

export interface OAuthProvider {
  platform: TargetPlatform;
  /** What the person is being asked to allow, in the platform's own words. */
  scopes: string[];
  authorizeUrl(options: { app: OAuthApp; redirectUri: string; state: string }): string;
  exchange(options: {
    app: OAuthApp;
    redirectUri: string;
    code: string;
  }): Promise<ConnectedAccount>;
}

/**
 * A field the platform sent, if it really is a string. Anything else is treated as absent
 * rather than stringified: "[object Object]" as an access token fails much later and much
 * more confusingly than no access token at all.
 */
function text(value: unknown): string {
  return typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '';
}

async function json(response: Response, what: string): Promise<Record<string, unknown>> {
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    // The platform's own words, kept whole: the Sync centre and the connect screen both show
    // them verbatim, and a rewritten error is a worse error (WP35).
    throw new AdapterError({
      code: `HTTP_${response.status}`,
      message: typeof body.error_message === 'string' ? body.error_message : JSON.stringify(body),
      category: response.status === 401 || response.status === 403 ? 'reauth' : 'terminal',
    });
  }
  if (typeof body !== 'object') throw new Error(`${what} answered something that is not an object`);
  return body;
}

/**
 * Instagram Login (docs/spikes/instagram.md): the code buys a short lived token, which is then
 * traded for a long lived one. Only the long lived token is kept; a token that dies in an hour
 * is not worth encrypting.
 */
export const instagramOAuth: OAuthProvider = {
  platform: 'instagram',
  scopes: ['instagram_business_basic', 'instagram_business_content_publish'],

  authorizeUrl: ({ app, redirectUri, state }) =>
    `https://www.instagram.com/oauth/authorize?${new URLSearchParams({
      client_id: app.clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: instagramOAuth.scopes.join(','),
      state,
    }).toString()}`,

  async exchange({ app, redirectUri, code }) {
    try {
      const short = await json(
        await fetch('https://api.instagram.com/oauth/access_token', {
          method: 'POST',
          body: new URLSearchParams({
            client_id: app.clientId,
            client_secret: app.clientSecret,
            grant_type: 'authorization_code',
            redirect_uri: redirectUri,
            code,
          }),
        }),
        'Instagram',
      );

      // Sixty days rather than one hour, which is the difference between a demo that works
      // next week and one that does not.
      const long = await json(
        await fetch(
          `https://graph.instagram.com/access_token?${new URLSearchParams({
            grant_type: 'ig_exchange_token',
            client_secret: app.clientSecret,
            access_token: text(short.access_token),
          }).toString()}`,
        ),
        'Instagram',
      );
      const accessToken = text(long.access_token) || text(short.access_token);
      if (!accessToken) throw new Error('Instagram returned no access token');

      const me = await json(
        await fetch(
          `https://graph.instagram.com/v21.0/me?${new URLSearchParams({
            fields: 'user_id,username',
            access_token: accessToken,
          }).toString()}`,
        ),
        'Instagram',
      );
      const seconds = Number(long.expires_in ?? 0);
      return {
        platform: 'instagram',
        externalId: text(me.user_id) || text(short.user_id),
        displayName: text(me.username) ? `@${text(me.username)}` : null,
        accessToken,
        expiresAt: seconds > 0 ? new Date(Date.now() + seconds * 1000) : null,
        scopes: instagramOAuth.scopes,
      };
    } catch (err) {
      throw normalizeError('instagram-oauth', err);
    }
  },
};

/**
 * LinkedIn (docs/spikes/linkedin.md): one exchange, and the member's own id comes from the
 * OpenID userinfo endpoint rather than from the token response.
 */
export const linkedinOAuth: OAuthProvider = {
  platform: 'linkedin',
  scopes: ['openid', 'profile', 'w_member_social'],

  authorizeUrl: ({ app, redirectUri, state }) =>
    `https://www.linkedin.com/oauth/v2/authorization?${new URLSearchParams({
      response_type: 'code',
      client_id: app.clientId,
      redirect_uri: redirectUri,
      // LinkedIn wants its scopes space separated, where Instagram wants commas.
      scope: linkedinOAuth.scopes.join(' '),
      state,
    }).toString()}`,

  async exchange({ app, redirectUri, code }) {
    try {
      const token = await json(
        await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'authorization_code',
            code,
            redirect_uri: redirectUri,
            client_id: app.clientId,
            client_secret: app.clientSecret,
          }),
        }),
        'LinkedIn',
      );
      const accessToken = text(token.access_token);
      if (!accessToken) throw new Error('LinkedIn returned no access token');

      const me = await json(
        await fetch('https://api.linkedin.com/v2/userinfo', {
          headers: { authorization: `Bearer ${accessToken}` },
        }),
        'LinkedIn',
      );
      const seconds = Number(token.expires_in ?? 0);
      return {
        platform: 'linkedin',
        externalId: text(me.sub),
        displayName: typeof me.name === 'string' ? me.name : null,
        accessToken,
        expiresAt: seconds > 0 ? new Date(Date.now() + seconds * 1000) : null,
        scopes: linkedinOAuth.scopes,
      };
    } catch (err) {
      throw normalizeError('linkedin-oauth', err);
    }
  },
};

export const OAUTH_PROVIDERS: Record<TargetPlatform, OAuthProvider> = {
  instagram: instagramOAuth,
  linkedin: linkedinOAuth,
};
