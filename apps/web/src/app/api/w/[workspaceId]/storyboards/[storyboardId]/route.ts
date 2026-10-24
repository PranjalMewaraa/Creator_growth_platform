import { deleteStoryboard, findStoryboard, renameStoryboard, setBoardAssembled } from '@cgp/db';
import { apiError, apiWorkspace, jsonBody } from '@/server/api';
import { withRequestContext } from '@/server/request-context';
import { getDb } from '@/server/runtime';

type Context = { params: Promise<{ workspaceId: string; storyboardId: string }> };

export const GET = withRequestContext(async (_request: Request, { params }: Context) => {
  const { workspaceId, storyboardId } = await params;
  const access = await apiWorkspace(workspaceId);
  if (!access.ok) return access.response;

  const board = await findStoryboard(getDb(), workspaceId, storyboardId);
  return board ? Response.json({ storyboard: board }) : apiError(404, 'storyboard_not_found');
});

export const PATCH = withRequestContext(async (request: Request, { params }: Context) => {
  const { workspaceId, storyboardId } = await params;
  const access = await apiWorkspace(workspaceId);
  if (!access.ok) return access.response;

  const body = (await jsonBody(request)) as
    | { name?: string; finalOutputId?: string; finalVideoUrl?: string }
    | undefined;

  if (body?.finalOutputId && body.finalVideoUrl) {
    await setBoardAssembled(getDb(), workspaceId, storyboardId, {
      outputId: body.finalOutputId,
      finalVideoUrl: body.finalVideoUrl,
    });
    return Response.json({ ok: true });
  }

  const name = body?.name?.trim() ?? '';
  if (!name) {
    return apiError(422, 'invalid_input', { issues: [{ path: 'name', message: 'Name a board' }] });
  }

  await renameStoryboard(getDb(), workspaceId, storyboardId, name);
  return Response.json({ ok: true });
});

export const DELETE = withRequestContext(async (_request: Request, { params }: Context) => {
  const { workspaceId, storyboardId } = await params;
  const access = await apiWorkspace(workspaceId);
  if (!access.ok) return access.response;

  await deleteStoryboard(getDb(), workspaceId, storyboardId);
  return Response.json({ ok: true });
});
