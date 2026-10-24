import { storeReferenceImage } from '@cgp/core';
import { setSceneUploadedImage } from '@cgp/db';
import { apiError, apiWorkspace, refusal } from '@/server/api';
import { withRequestContext } from '@/server/request-context';
import { getDb, getLogger } from '@/server/runtime';
import { getProviders } from '@/server/providers';

type Context = { params: Promise<{ workspaceId: string; storyboardId: string; sceneId: string }> };

/** A still the creator uploaded directly for this scene — held for 8s in the final video
 *  rather than animated, unlike a reference image (WP69). Reuses storeReferenceImage: same
 *  validation and moderation, just a different destination on the scene row. */
export const POST = withRequestContext(async (request: Request, { params }: Context) => {
  const { workspaceId, sceneId } = await params;
  const access = await apiWorkspace(workspaceId);
  if (!access.ok) return access.response;

  const form = await request.formData().catch(() => undefined);
  const file = form?.get('file');
  if (!(file instanceof File)) {
    return apiError(422, 'invalid_input', {
      issues: [{ path: 'file', message: 'Choose an image to upload' }],
    });
  }

  const providers = getProviders();
  const result = await storeReferenceImage(
    { store: providers.store, moderation: providers.moderation, log: getLogger() },
    workspaceId,
    new Uint8Array(await file.arrayBuffer()),
  );
  if (!result.ok) return refusal(result);

  const durationSeconds = 8;
  await setSceneUploadedImage(getDb(), workspaceId, sceneId, { imageUrl: result.url, durationSeconds });
  return Response.json({ scene: { imageUrl: result.url, durationSeconds } });
});
