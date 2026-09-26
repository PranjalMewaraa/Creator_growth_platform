import { syncCentre } from '@cgp/core';
import { apiWorkspace } from '@/server/api';
import { withRequestContext } from '@/server/request-context';
import { getDb } from '@/server/runtime';

type Context = { params: Promise<{ workspaceId: string }> };

/** What is publishing and what just tried (S-20, WP35). */
export const GET = withRequestContext(async (_request: Request, { params }: Context) => {
  const { workspaceId } = await params;
  const access = await apiWorkspace(workspaceId);
  if (!access.ok) return access.response;

  return Response.json({ sync: await syncCentre(getDb(), workspaceId) });
});
