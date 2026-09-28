import { TARGET_PLATFORMS, type TargetPlatform } from '@cgp/contracts';
import { OAUTH_PROVIDERS } from '@cgp/adapters';
import { beginConnect } from '@cgp/core';
import { apiError, apiWorkspace } from '@/server/api';
import { withRequestContext } from '@/server/request-context';
import { getEnv } from '@/server/runtime';
import { oauthApp, redirectUriFor, STATE_COOKIE } from '@/server/oauth';

type Context = { params: Promise<{ workspaceId: string; platform: string }> };

/**
 * Starts a connect (S-03, WP28): answers a redirect to the platform's consent screen and
 * remembers the state in a cookie the browser sends back with the callback.
 *
 * The state travels twice, once through the platform and once in the cookie, and the callback
 * compares them. A state that only came back through the address bar proves nothing.
 */
export const GET = withRequestContext(async (_request: Request, { params }: Context) => {
  const { workspaceId, platform } = await params;
  const access = await apiWorkspace(workspaceId);
  if (!access.ok) return access.response;
  if (!TARGET_PLATFORMS.includes(platform as TargetPlatform)) return apiError(404, 'not_found');

  const env = getEnv();
  const app = oauthApp(env, platform as TargetPlatform);
  if (!app) {
    return apiError(422, 'not_configured', {
      issues: [
        {
          path: 'platform',
          message: `No ${platform} app is configured on this server. Set its client id and secret first.`,
        },
      ],
    });
  }

  const { url, state } = beginConnect({
    secret: env.AUTH_SECRET,
    provider: OAUTH_PROVIDERS[platform as TargetPlatform],
    app,
    redirectUri: redirectUriFor(env.APP_URL, platform as TargetPlatform),
    workspaceId,
  });

  const response = Response.redirect(url, 302);
  const headers = new Headers(response.headers);
  headers.append(
    'set-cookie',
    // Lax, not Strict: the platform sends the person back with a top level GET, and Strict
    // would withhold the cookie on exactly that request.
    `${STATE_COOKIE}=${state}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600${
      env.APP_URL.startsWith('https://') ? '; Secure' : ''
    }`,
  );
  return new Response(null, { status: 302, headers });
});
