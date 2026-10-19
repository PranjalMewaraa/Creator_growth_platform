import { recentOutputsFeed } from '@cgp/core';
import { apiWorkspace } from '@/server/api';
import { withRequestContext } from '@/server/request-context';
import { getDb } from '@/server/runtime';

type Context = { params: Promise<{ workspaceId: string }> };

/** The Studio's gallery feed (WP64): every output across the workspace, newest first, paged
 *  with a `before` cursor rather than an offset so a page already scrolled past never shifts
 *  under a creator who is still scrolling. */
export const GET = withRequestContext(async (request: Request, { params }: Context) => {
  const { workspaceId } = await params;
  const access = await apiWorkspace(workspaceId);
  if (!access.ok) return access.response;

  const url = new URL(request.url);
  const before = url.searchParams.get('before') ?? undefined;
  const limitParam = url.searchParams.get('limit');
  const limit = limitParam ? Math.min(60, Math.max(1, Number(limitParam) || 24)) : undefined;

  const feed = await recentOutputsFeed(getDb(), workspaceId, { before, limit });
  return Response.json({ feed });
});
