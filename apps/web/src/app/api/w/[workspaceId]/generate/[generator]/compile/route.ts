import { compileGeneration, generators } from '@cgp/core';
import { apiWorkspace, jsonBody, refusal } from '@/server/api';
import { withRequestContext } from '@/server/request-context';
import { getDb, getLogger } from '@/server/runtime';
import { getProviders } from '@/server/providers';

type Context = { params: Promise<{ workspaceId: string; generator: string }> };

/**
 * Plain intent to a compiled prompt the user can read and edit before dispatching it (the
 * compiled prompt disclosure). Holds and charges nothing.
 */
export const POST = withRequestContext(async (request: Request, { params }: Context) => {
  const { workspaceId, generator } = await params;
  const access = await apiWorkspace(workspaceId);
  if (!access.ok) return access.response;

  const result = await compileGeneration(
    {
      db: getDb(),
      registry: generators,
      compile: { rewriters: getProviders().rewriters, log: getLogger() },
    },
    { workspaceId, generatorKey: generator, input: await jsonBody(request) },
  );
  if (!result.ok) return refusal(result);
  return Response.json({ prompt: result.prompt, estimate: result.estimate }, { status: 201 });
});
