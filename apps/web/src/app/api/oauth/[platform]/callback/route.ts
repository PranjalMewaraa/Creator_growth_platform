import { parseEncryptionKey, encryptSecret } from '@cgp/config';
import { TARGET_PLATFORMS, type TargetPlatform } from '@cgp/contracts';
import { OAUTH_PROVIDERS } from '@cgp/adapters';
import { completeConnect, readState } from '@cgp/core';
import { apiError } from '@/server/api';
import { withRequestContext } from '@/server/request-context';
import { getDb, getEnv, getLogger } from '@/server/runtime';
import { oauthApp, redirectUriFor, STATE_COOKIE } from '@/server/oauth';

type Context = { params: Promise<{ platform: string }> };

/**
 * Where the platform sends the person back (WP28). One fixed path per platform, because a
 * redirect URI has to match the dashboard exactly; which workspace this belongs to is carried
 * in the signed state, not in the path.
 *
 * Everything here ends in a redirect to the Accounts screen, carrying a word about how it
 * went, because a person who has just clicked Allow should land somewhere that says so.
 */
export const GET = withRequestContext(async (request: Request, { params }: Context) => {
  const { platform } = await params;
  if (!TARGET_PLATFORMS.includes(platform as TargetPlatform)) return apiError(404, 'not_found');
  const env = getEnv();
  const log = getLogger();

  const url = new URL(request.url);
  const returned = url.searchParams.get('state');
  const cookie = request.headers
    .get('cookie')
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${STATE_COOKIE}=`))
    ?.slice(STATE_COOKIE.length + 1);

  // Which workspace to return to. Read from the cookie even when the connect fails, so a
  // refusal lands back on the screen it started from rather than nowhere.
  const opened = cookie
    ? readState(env.AUTH_SECRET, cookie, { platform: platform as TargetPlatform })
    : undefined;
  const home = opened?.ok ? `/w/${opened.state.workspaceId}/accounts` : '/';
  const back = (status: string) =>
    Response.redirect(new URL(`${home}?connect=${status}`, env.APP_URL).toString(), 302);

  // The state must come back through both the address bar and the cookie, and match. One
  // without the other is someone else's callback.
  if (!cookie || !returned || cookie !== returned) {
    log.warn({ platform, hasCookie: Boolean(cookie) }, 'connect callback state did not match');
    return back('bad_state');
  }

  const app = oauthApp(env, platform as TargetPlatform);
  if (!app || !env.TOKEN_ENCRYPTION_KEY) return back('not_configured');
  const kek = parseEncryptionKey(env.TOKEN_ENCRYPTION_KEY);

  const result = await completeConnect(
    {
      db: getDb(),
      log,
      secret: env.AUTH_SECRET,
      provider: OAUTH_PROVIDERS[platform as TargetPlatform],
      app,
      redirectUri: redirectUriFor(env.APP_URL, platform as TargetPlatform),
      encryptToken: (token) => encryptSecret(kek, token),
    },
    {
      code: url.searchParams.get('code'),
      state: returned,
      error:
        url.searchParams.get('error_description') ??
        url.searchParams.get('error_message') ??
        url.searchParams.get('error'),
    },
  );

  const response = back(result.ok ? 'connected' : result.reason);
  const headers = new Headers(response.headers);
  // The state is spent either way: it is good for one callback and no more.
  headers.append('set-cookie', `${STATE_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
  return new Response(null, { status: 302, headers });
});
