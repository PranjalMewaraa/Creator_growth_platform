import 'server-only';
import type { TargetPlatform } from '@cgp/contracts';
import type { OAuthApp } from '@cgp/adapters';
import type { WebEnv } from './runtime';

/**
 * Where the connect flow's pieces agree with each other (WP28): the cookie name, and the
 * redirect URI, which has to be spelled the same here as in each platform's dashboard or the
 * platform refuses the exchange.
 */

export const STATE_COOKIE = 'cgp_connect';

/** One fixed path per platform, with no workspace in it: the workspace rides in the state. */
export function redirectUriFor(appUrl: string, platform: TargetPlatform): string {
  return new URL(`/api/oauth/${platform}/callback`, appUrl).toString();
}

/** The app a platform connects through, or nothing when this server has no credentials for it. */
export function oauthApp(env: WebEnv, platform: TargetPlatform): OAuthApp | undefined {
  const pair =
    platform === 'instagram'
      ? { clientId: env.INSTAGRAM_CLIENT_ID, clientSecret: env.INSTAGRAM_CLIENT_SECRET }
      : { clientId: env.LINKEDIN_CLIENT_ID, clientSecret: env.LINKEDIN_CLIENT_SECRET };
  return pair.clientId && pair.clientSecret
    ? { clientId: pair.clientId, clientSecret: pair.clientSecret }
    : undefined;
}
