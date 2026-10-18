import { toggleTrendBookmark } from '@cgp/core';
import { apiWorkspace, jsonBody, refusal } from '@/server/api';
import { withRequestContext } from '@/server/request-context';
import { getDb } from '@/server/runtime';

type Context = { params: Promise<{ workspaceId: string; trendId: string }> };

/** Save or unsave a trend (WP61). Bookmarking is this member's own act, not the trend's own
 *  data, so it is written through the workspace scope like any other tenant data. */
export const POST = withRequestContext(async (request: Request, { params }: Context) => {
  const { workspaceId, trendId } = await params;
  const access = await apiWorkspace(workspaceId);
  if (!access.ok) return access.response;

  const body = (await jsonBody(request)) as { save?: unknown } | undefined;
  const save = body?.save !== false;

  const result = await toggleTrendBookmark(getDb(), workspaceId, access.user.id, trendId, save);
  if (!result.ok) return refusal(result);
  return Response.json({ ok: true, save });
});
