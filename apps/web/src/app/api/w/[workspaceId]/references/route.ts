import { MAX_UPLOAD_BYTES, storeReferenceImage } from '@cgp/core';
import { apiError, apiWorkspace, refusal } from '@/server/api';
import { withRequestContext } from '@/server/request-context';
import { getLogger } from '@/server/runtime';
import { getProviders } from '@/server/providers';

type Context = { params: Promise<{ workspaceId: string }> };

/**
 * A picture for image generation to stay consistent with (WP60), as multipart form data with a
 * `file` field — the same shape as `/uploads`, a smaller store: no Instagram copies, since a
 * reference is read by a model, never posted.
 */
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
  const result = await storeReferenceImage(
    { store: providers.store, moderation: providers.moderation, log: getLogger() },
    workspaceId,
    new Uint8Array(await file.arrayBuffer()),
  );
  if (!result.ok) return refusal(result);
  const { key, url, mimeType, bytes } = result;
  return Response.json({ reference: { key, url, mimeType, bytes } }, { status: 201 });
});
