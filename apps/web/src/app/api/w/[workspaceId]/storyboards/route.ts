import { createStoryboard, listStoryboards } from '@cgp/db';
import { apiError, apiWorkspace, jsonBody } from '@/server/api';
import { withRequestContext } from '@/server/request-context';
import { getDb } from '@/server/runtime';

type Context = { params: Promise<{ workspaceId: string }> };

/** Named, revisitable storyboards (WP67) — not the AI-planned `storyboard` generator's one-shot
 *  sequence, a board a creator builds scene by scene over multiple sessions. */
export const GET = withRequestContext(async (_request: Request, { params }: Context) => {
  const { workspaceId } = await params;
  const access = await apiWorkspace(workspaceId);
  if (!access.ok) return access.response;

  const boards = await listStoryboards(getDb(), workspaceId);
  return Response.json({ storyboards: boards });
});

export const POST = withRequestContext(async (request: Request, { params }: Context) => {
  const { workspaceId } = await params;
  const access = await apiWorkspace(workspaceId);
  if (!access.ok) return access.response;

  const body = await jsonBody(request);
  const name = body && typeof body === 'object' && 'name' in body ? String(body.name).trim() : '';
  if (!name) {
    return apiError(422, 'invalid_input', { issues: [{ path: 'name', message: 'Name a board' }] });
  }

  const board = await createStoryboard(getDb(), workspaceId, name);
  return Response.json({ storyboard: board }, { status: 201 });
});
