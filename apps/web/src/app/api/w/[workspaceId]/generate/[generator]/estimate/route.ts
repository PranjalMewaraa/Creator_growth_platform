import { estimateGeneration, generators } from '@cgp/core';
import { apiError, apiWorkspace, jsonBody } from '@/server/api';
import { withRequestContext } from '@/server/request-context';
import { getDb } from '@/server/runtime';

type Context = { params: Promise<{ workspaceId: string; generator: string }> };

/** The cost shown before submit. Holds nothing. */
export const POST = withRequestContext(async (request: Request, { params }: Context) => {
  const { workspaceId, generator } = await params;
  const access = await apiWorkspace(workspaceId);
  if (!access.ok) return access.response;

  const result = await estimateGeneration(getDb(), generators, generator, await jsonBody(request));
  if (result.ok) {
    return Response.json({ estimate: result.estimate, ratesVersion: result.ratesVersion });
  }
  if (result.reason === 'unknown_generator') return apiError(404, result.reason);
  return apiError(422, result.reason, { issues: result.issues });
});
