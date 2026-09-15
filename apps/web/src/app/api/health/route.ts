import { getEnv, getLogger } from '@/server/runtime';
import { withRequestContext } from '@/server/request-context';

export const GET = withRequestContext(() => {
  const { PROVIDERS } = getEnv();
  getLogger().info('health check');
  return Response.json({ ok: true, service: 'web', providers: PROVIDERS });
});
