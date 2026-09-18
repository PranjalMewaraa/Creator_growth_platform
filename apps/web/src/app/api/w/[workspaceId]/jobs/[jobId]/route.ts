import { findJob } from '@cgp/core';
import { apiError, apiWorkspace } from '@/server/api';
import { withRequestContext } from '@/server/request-context';
import { getDb } from '@/server/runtime';

type Context = { params: Promise<{ workspaceId: string; jobId: string }> };

/** One job's status: the polling fallback when the event stream is unavailable. */
export const GET = withRequestContext(async (_request: Request, { params }: Context) => {
  const { workspaceId, jobId } = await params;
  const access = await apiWorkspace(workspaceId);
  if (!access.ok) return access.response;

  const job = await findJob(getDb(), workspaceId, jobId);
  return job ? Response.json({ job }) : apiError(404, 'job_not_found');
});
