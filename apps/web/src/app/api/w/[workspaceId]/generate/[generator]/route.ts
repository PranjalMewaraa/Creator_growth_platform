import { currentCorrelationId } from '@cgp/config';
import { generators, startGeneration } from '@cgp/core';
import { apiError, apiWorkspace, jsonBody } from '@/server/api';
import { withRequestContext } from '@/server/request-context';
import { getDb, getLogger, getQueues } from '@/server/runtime';

type Context = { params: Promise<{ workspaceId: string; generator: string }> };

/**
 * The one generate route, for every generator (FR-GN-02): the generator key comes from the
 * URL and everything specific to it comes from the registry. Answers 202 once the job and its
 * credit hold have committed; progress is at the job's events route.
 */
export const POST = withRequestContext(async (request: Request, { params }: Context) => {
  const { workspaceId, generator } = await params;
  const access = await apiWorkspace(workspaceId);
  if (!access.ok) return access.response;

  const result = await startGeneration(
    { db: getDb(), queues: getQueues(), log: getLogger(), registry: generators },
    {
      workspaceId,
      generatorKey: generator,
      input: await jsonBody(request),
      correlationId: currentCorrelationId(),
    },
  );

  if (result.ok) {
    const location = `/api/w/${workspaceId}/jobs/${result.job.id}`;
    getLogger().info({ jobId: result.job.id, generator }, 'generation queued');
    return Response.json(
      { job: result.job, estimate: result.estimate, events: `${location}/events` },
      { status: 202, headers: { location } },
    );
  }
  switch (result.reason) {
    case 'unknown_generator':
    case 'workspace_not_found':
      return apiError(404, result.reason);
    case 'invalid_input':
      return apiError(422, result.reason, { issues: result.issues });
    case 'insufficient_credits':
    case 'insufficient_video_seconds':
      return apiError(402, result.reason);
  }
});
