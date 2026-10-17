import { currentCorrelationId } from '@cgp/config';
import { generators, startGeneration } from '@cgp/core';
import { apiWorkspace, jsonBody, refusal } from '@/server/api';
import { withRequestContext } from '@/server/request-context';
import { getDb, getLogger, getQueues } from '@/server/runtime';
import { getProviders } from '@/server/providers';

type Context = { params: Promise<{ workspaceId: string; generator: string }> };

// Same reasoning as the compile route (WP57): image/thumbnail/video briefs ask the rewrite
// model for several labelled sections rather than one paragraph, so they get more than the
// 1500ms invariant-11 default when this route compiles one itself (no compiledPromptId given).
const RICH_REWRITE_OUTPUT_TYPES = new Set(['image', 'thumbnail', 'video']);
const RICH_REWRITE_BUDGET_MS = 6000;

/**
 * The one generate route, for every generator (FR-GN-02): the generator key comes from the
 * URL and everything specific to it comes from the registry. The body is the generator's
 * input, plus `compiledPromptId` to dispatch a prompt the user compiled and edited first;
 * without it the request is compiled now. Answers 202 once the job and its credit hold have
 * committed; progress is at the job's events route.
 */
export const POST = withRequestContext(async (request: Request, { params }: Context) => {
  const { workspaceId, generator } = await params;
  const access = await apiWorkspace(workspaceId);
  if (!access.ok) return access.response;

  const body = await jsonBody(request);
  const compiledPromptId =
    body && typeof body === 'object' && 'compiledPromptId' in body
      ? String(body.compiledPromptId)
      : undefined;
  const providers = getProviders();
  const outputType = generators.get(generator)?.outputType;
  const rewriteBudgetMs = outputType && RICH_REWRITE_OUTPUT_TYPES.has(outputType)
    ? RICH_REWRITE_BUDGET_MS
    : undefined;
  const result = await startGeneration(
    {
      db: getDb(),
      queues: getQueues(),
      log: getLogger(),
      registry: generators,
      compile: { rewriters: providers.rewriters, log: getLogger(), rewriteBudgetMs },
      moderation: providers.moderation,
    },
    {
      workspaceId,
      generatorKey: generator,
      input: body,
      compiledPromptId,
      correlationId: currentCorrelationId(),
    },
  );

  if (!result.ok) return refusal(result);
  const location = `/api/w/${workspaceId}/jobs/${result.job.id}`;
  getLogger().info({ jobId: result.job.id, generator }, 'generation queued');
  return Response.json(
    {
      job: result.job,
      estimate: result.estimate,
      prompt: result.prompt,
      events: `${location}/events`,
    },
    { status: 202, headers: { location } },
  );
});
