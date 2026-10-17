import { compileGeneration, generators } from '@cgp/core';
import { apiWorkspace, jsonBody, refusal } from '@/server/api';
import { withRequestContext } from '@/server/request-context';
import { getDb, getLogger } from '@/server/runtime';
import { getProviders } from '@/server/providers';

type Context = { params: Promise<{ workspaceId: string; generator: string }> };

// Invariant 11 gives the rewrite pass 1500ms by default, sized for a plain prose rewrite. The
// image/thumbnail/video prompt now asks for a style pick plus up to eight labelled sections
// (WP57) — several times the output of the brief rewrite it replaced — so those three alone get
// a longer, still-bounded budget; script/hook/caption keep the 1500ms default untouched.
const RICH_REWRITE_OUTPUT_TYPES = new Set(['image', 'thumbnail', 'video']);
const RICH_REWRITE_BUDGET_MS = 6000;

/**
 * Plain intent to a compiled prompt the user can read and edit before dispatching it (the
 * compiled prompt disclosure). Holds and charges nothing.
 */
export const POST = withRequestContext(async (request: Request, { params }: Context) => {
  const { workspaceId, generator } = await params;
  const access = await apiWorkspace(workspaceId);
  if (!access.ok) return access.response;

  const outputType = generators.get(generator)?.outputType;
  const rewriteBudgetMs = outputType && RICH_REWRITE_OUTPUT_TYPES.has(outputType)
    ? RICH_REWRITE_BUDGET_MS
    : undefined;

  const result = await compileGeneration(
    {
      db: getDb(),
      registry: generators,
      compile: { rewriters: getProviders().rewriters, log: getLogger(), rewriteBudgetMs },
    },
    { workspaceId, generatorKey: generator, input: await jsonBody(request) },
  );
  if (!result.ok) return refusal(result);
  return Response.json({ prompt: result.prompt, estimate: result.estimate }, { status: 201 });
});
