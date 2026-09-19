import { MAX_LOGO_BYTES, storeLogo } from '@cgp/core';
import { apiError, apiWorkspace, refusal } from '@/server/api';
import { withRequestContext } from '@/server/request-context';
import { getLogger, getProviders } from '@/server/runtime';

type Context = { params: Promise<{ workspaceId: string }> };

/** A logo as multipart form data with a `file` field. Saved to the kit only when the kit is. */
export const POST = withRequestContext(async (request: Request, { params }: Context) => {
  const { workspaceId } = await params;
  const access = await apiWorkspace(workspaceId);
  if (!access.ok) return access.response;

  if (Number(request.headers.get('content-length') ?? 0) > MAX_LOGO_BYTES + 64 * 1024) {
    return apiError(413, 'invalid_input', {
      issues: [{ path: 'file', message: 'Logos can be at most 2 MB' }],
    });
  }
  const file = (await request.formData().catch(() => undefined))?.get('file');
  if (!(file instanceof File)) {
    return apiError(422, 'invalid_input', {
      issues: [{ path: 'file', message: 'Choose a logo to upload' }],
    });
  }
  const providers = getProviders();
  const result = await storeLogo(
    { store: providers.store, moderation: providers.moderation, log: getLogger() },
    workspaceId,
    new Uint8Array(await file.arrayBuffer()),
  );
  if (!result.ok) return refusal(result);
  return Response.json({ logoUrl: result.url }, { status: 201 });
});
