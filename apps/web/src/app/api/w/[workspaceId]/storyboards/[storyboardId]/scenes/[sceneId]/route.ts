import { removeScene, setSceneResult, updateScene } from '@cgp/db';
import { apiWorkspace, jsonBody } from '@/server/api';
import { withRequestContext } from '@/server/request-context';
import { getDb } from '@/server/runtime';

type Context = { params: Promise<{ workspaceId: string; storyboardId: string; sceneId: string }> };

interface ScenePatch {
  prompt?: string;
  references?: Array<{ key: string; url: string; mimeType: string }>;
  outputId?: string;
  videoUrl?: string;
  status?: 'complete';
}

/** Edits a scene's prompt/references, or — once the client's own job-watching sees a
 *  generation finish — records the result (outputId/videoUrl/status) straight onto the row. */
export const PATCH = withRequestContext(async (request: Request, { params }: Context) => {
  const { workspaceId, sceneId } = await params;
  const access = await apiWorkspace(workspaceId);
  if (!access.ok) return access.response;

  const body = (await jsonBody(request)) as ScenePatch | undefined;
  if (!body || typeof body !== 'object') {
    return Response.json({ ok: true });
  }

  const { prompt, references, outputId, videoUrl, status } = body;
  if (outputId && videoUrl && status === 'complete') {
    await setSceneResult(getDb(), workspaceId, sceneId, { outputId, videoUrl });
  } else {
    await updateScene(getDb(), workspaceId, sceneId, {
      ...(prompt !== undefined ? { prompt } : {}),
      ...(references !== undefined ? { references } : {}),
    });
  }
  return Response.json({ ok: true });
});

export const DELETE = withRequestContext(async (_request: Request, { params }: Context) => {
  const { workspaceId, sceneId } = await params;
  const access = await apiWorkspace(workspaceId);
  if (!access.ok) return access.response;

  await removeScene(getDb(), workspaceId, sceneId);
  return Response.json({ ok: true });
});
