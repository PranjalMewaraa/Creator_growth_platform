import { attachOutputToPost } from '@cgp/core';
import { apiError, apiWorkspace, refusal } from '@/server/api';
import { withRequestContext } from '@/server/request-context';
import { getDb, getLogger } from '@/server/runtime';
import { getProviders } from '@/server/providers';

type Context = { params: Promise<{ workspaceId: string; outputId: string }> };

/**
 * Takes something the Studio made into the composer (S-13, WP33): the picture is copied into
 * the workspace's uploads with its Instagram frames, and the caption comes with it.
 */
export const POST = withRequestContext(async (_request: Request, { params }: Context) => {
  const { workspaceId, outputId } = await params;
  const access = await apiWorkspace(workspaceId);
  if (!access.ok) return access.response;

  const providers = getProviders();
  const result = await attachOutputToPost(
    { db: getDb(), store: providers.store, moderation: providers.moderation, log: getLogger() },
    workspaceId,
    outputId,
  );
  if (!result.ok) {
    if (result.reason === 'not_found') return apiError(404, 'not_found');
    if (result.reason === 'not_postable') {
      return apiError(422, 'not_postable', {
        issues: [
          {
            path: 'output',
            message:
              'Reels cannot be published from here yet: the Instagram and LinkedIn adapters post images. Download it and post it by hand.',
          },
        ],
      });
    }
    if (result.reason === 'invalid_input') {
      return apiError(422, 'invalid_input', {
        issues: [{ path: 'output', message: result.message }],
      });
    }
    return refusal(result);
  }

  return Response.json({
    upload: result.upload,
    text: result.text,
    sourceOutputId: result.sourceOutputId,
  });
});
