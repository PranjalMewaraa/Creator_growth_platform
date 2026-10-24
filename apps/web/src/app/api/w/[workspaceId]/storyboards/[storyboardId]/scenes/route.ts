import { addScene } from '@cgp/db';
import { apiWorkspace } from '@/server/api';
import { withRequestContext } from '@/server/request-context';
import { getDb } from '@/server/runtime';

type Context = { params: Promise<{ workspaceId: string; storyboardId: string }> };

/** A blank scene at the next index, for the creator to fill in before generating. */
export const POST = withRequestContext(async (_request: Request, { params }: Context) => {
  const { workspaceId, storyboardId } = await params;
  const access = await apiWorkspace(workspaceId);
  if (!access.ok) return access.response;

  const scene = await addScene(getDb(), workspaceId, storyboardId);
  return Response.json({ scene }, { status: 201 });
});
