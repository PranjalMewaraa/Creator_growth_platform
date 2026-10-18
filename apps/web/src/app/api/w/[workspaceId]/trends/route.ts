import { listTrendsView } from '@cgp/core';
import { apiWorkspace } from '@/server/api';
import { withRequestContext } from '@/server/request-context';
import { getDb } from '@/server/runtime';

type Context = { params: Promise<{ workspaceId: string }> };

/** The Trend Radar's own read (WP61): every niche ever ingested, and the list filtered to the
 *  niche/region asked for, each row marked with whether this member already saved it. */
export const GET = withRequestContext(async (request: Request, { params }: Context) => {
  const { workspaceId } = await params;
  const access = await apiWorkspace(workspaceId);
  if (!access.ok) return access.response;

  const url = new URL(request.url);
  const niche = url.searchParams.get('niche') ?? undefined;
  const region = url.searchParams.get('region') ?? undefined;

  const view = await listTrendsView(getDb(), workspaceId, access.user.id, { niche, region });
  return Response.json(view);
});
