import { MAX_CLIP_BYTES, storeSceneClip } from '@cgp/core';
import { setSceneUploadedClip } from '@cgp/db';
import { apiError, apiWorkspace, refusal } from '@/server/api';
import { withRequestContext } from '@/server/request-context';
import { getDb, getLogger } from '@/server/runtime';
import { getProviders } from '@/server/providers';

type Context = { params: Promise<{ workspaceId: string; storyboardId: string; sceneId: string }> };

/** A clip the creator uploaded directly for this scene, as multipart form data with a `file`
 *  field — same shape as `/references`, skipping generation for this scene entirely (WP68). */
export const POST = withRequestContext(async (request: Request, { params }: Context) => {
  const { workspaceId, sceneId } = await params;
  const access = await apiWorkspace(workspaceId);
  if (!access.ok) return access.response;

  if (Number(request.headers.get('content-length') ?? 0) > MAX_CLIP_BYTES + 64 * 1024) {
    return apiError(413, 'invalid_input', {
      issues: [{ path: 'file', message: 'Clips can be at most 50 MB' }],
    });
  }
  const form = await request.formData().catch(() => undefined);
  const file = form?.get('file');
  if (!(file instanceof File)) {
    return apiError(422, 'invalid_input', {
      issues: [{ path: 'file', message: 'Choose a clip to upload' }],
    });
  }

  const providers = getProviders();
  const result = await storeSceneClip(
    { store: providers.store, log: getLogger() },
    workspaceId,
    new Uint8Array(await file.arrayBuffer()),
  );
  if (!result.ok) return refusal(result);

  await setSceneUploadedClip(getDb(), workspaceId, sceneId, {
    videoUrl: result.url,
    durationSeconds: result.durationSeconds,
  });
  return Response.json({ scene: { videoUrl: result.url, durationSeconds: result.durationSeconds } });
});
