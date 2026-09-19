import { jobOutputs } from '@cgp/core';
import { apiWorkspace } from '@/server/api';
import { withRequestContext } from '@/server/request-context';
import { getDb } from '@/server/runtime';

type Context = { params: Promise<{ workspaceId: string; jobId: string }> };

/** A job's finished outputs; empty until the job completes. */
export const GET = withRequestContext(async (_request: Request, { params }: Context) => {
  const { workspaceId, jobId } = await params;
  const access = await apiWorkspace(workspaceId);
  if (!access.ok) return access.response;
  return Response.json({ outputs: await jobOutputs(getDb(), workspaceId, jobId) });
});
