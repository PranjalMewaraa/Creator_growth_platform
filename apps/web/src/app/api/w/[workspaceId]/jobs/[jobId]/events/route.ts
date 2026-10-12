import { findJob, jobEventStream, subscribeDeltas } from '@cgp/core';
import { apiError, apiWorkspace } from '@/server/api';
import { withRequestContext } from '@/server/request-context';
import { getDb, getRedis } from '@/server/runtime';

type Context = { params: Promise<{ workspaceId: string; jobId: string }> };

export const dynamic = 'force-dynamic';

/**
 * Server sent events for one job (D9): status from Postgres, streamed text relayed from Redis.
 * The stream ends after a terminal status, or after about a minute, when EventSource
 * reconnects and picks up from the current status.
 */
export const GET = withRequestContext(async (_request: Request, { params }: Context) => {
  const { workspaceId, jobId } = await params;
  const access = await apiWorkspace(workspaceId);
  if (!access.ok) return access.response;

  const db = getDb();
  if (!(await findJob(db, workspaceId, jobId))) return apiError(404, 'job_not_found');

  const body = jobEventStream({
    read: () => findJob(db, workspaceId, jobId),
    subscribe: (onDelta, onStage) =>
      subscribeDeltas(getRedis(), jobId, onDelta, undefined, onStage),
  });
  return new Response(body, {
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
    },
  });
});
