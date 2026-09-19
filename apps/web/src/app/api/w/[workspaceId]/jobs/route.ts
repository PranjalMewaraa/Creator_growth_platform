import { recentGenerationJobs } from '@cgp/core';
import { apiWorkspace } from '@/server/api';
import { withRequestContext } from '@/server/request-context';
import { getDb } from '@/server/runtime';

type Context = { params: Promise<{ workspaceId: string }> };

/** Recent generation jobs, newest first, so the Studio can return to them. */
export const GET = withRequestContext(async (_request: Request, { params }: Context) => {
  const { workspaceId } = await params;
  const access = await apiWorkspace(workspaceId);
  if (!access.ok) return access.response;
  return Response.json({ jobs: await recentGenerationJobs(getDb(), workspaceId) });
});
