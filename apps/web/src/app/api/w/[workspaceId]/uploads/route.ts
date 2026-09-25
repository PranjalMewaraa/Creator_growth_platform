import { MAX_UPLOAD_BYTES, storeUpload } from '@cgp/core';
import { apiError, apiWorkspace, refusal } from '@/server/api';
import { withRequestContext } from '@/server/request-context';
import { getDb, getLogger } from '@/server/runtime';
import { getProviders } from '@/server/providers';

type Context = { params: Promise<{ workspaceId: string }> };

/** An image from the user's device, as multipart form data with a `file` field. */
export const POST = withRequestContext(async (request: Request, { params }: Context) => {
  const { workspaceId } = await params;
  const access = await apiWorkspace(workspaceId);
  if (!access.ok) return access.response;

  // Refuse early on the declared size, before reading the body.
  if (Number(request.headers.get('content-length') ?? 0) > MAX_UPLOAD_BYTES + 64 * 1024) {
    return apiError(413, 'invalid_input', {
      issues: [{ path: 'file', message: 'Images can be at most 8 MB' }],
    });
  }
  const form = await request.formData().catch(() => undefined);
  const file = form?.get('file');
  if (!(file instanceof File)) {
    return apiError(422, 'invalid_input', {
      issues: [{ path: 'file', message: 'Choose an image to upload' }],
    });
  }

  const providers = getProviders();
  const result = await storeUpload(
    { db: getDb(), store: providers.store, moderation: providers.moderation, log: getLogger() },
    workspaceId,
    new Uint8Array(await file.arrayBuffer()),
  );
  if (!result.ok) return refusal(result);
  const { key, url, mimeType, bytes, instagramUrls } = result;
  return Response.json({ upload: { key, url, mimeType, bytes, instagramUrls } }, { status: 201 });
});
