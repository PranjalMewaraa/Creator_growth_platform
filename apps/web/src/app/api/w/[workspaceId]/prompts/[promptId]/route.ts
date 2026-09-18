import { findCompiledPrompt, toView } from '@cgp/orchestration';
import { apiError, apiWorkspace } from '@/server/api';
import { withRequestContext } from '@/server/request-context';
import { getDb } from '@/server/runtime';

type Context = { params: Promise<{ workspaceId: string; promptId: string }> };

/** One compiled prompt with its lineage and resolved settings. */
export const GET = withRequestContext(async (_request: Request, { params }: Context) => {
  const { workspaceId, promptId } = await params;
  const access = await apiWorkspace(workspaceId);
  if (!access.ok) return access.response;

  const row = await findCompiledPrompt(getDb(), workspaceId, promptId);
  return row ? Response.json({ prompt: toView(row) }) : apiError(404, 'prompt_not_found');
});
