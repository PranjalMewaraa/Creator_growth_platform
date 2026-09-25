import { acceptOutput } from '@cgp/core';
import { apiError, apiWorkspace, refusal } from '@/server/api';
import { withRequestContext } from '@/server/request-context';
import { getDb } from '@/server/runtime';

type Context = { params: Promise<{ workspaceId: string; outputId: string }> };

/**
 * The creator kept this, in the state they kept it (WP20). Records how far it drifted from
 * what the engine wrote; the output itself is never changed.
 */
export const POST = withRequestContext(async (request: Request, { params }: Context) => {
  const { workspaceId, outputId } = await params;
  const access = await apiWorkspace(workspaceId);
  if (!access.ok) return access.response;

  const body = (await request.json().catch(() => undefined)) as
    { accepted?: unknown; generated?: unknown } | undefined;
  if (typeof body?.accepted !== 'string') {
    return apiError(422, 'invalid_input', {
      issues: [{ path: 'accepted', message: 'Send the text that was accepted' }],
    });
  }
  const result = await acceptOutput(
    getDb(),
    workspaceId,
    outputId,
    body.accepted,
    typeof body.generated === 'string' ? body.generated : undefined,
  );
  if (!result.ok) return refusal(result);
  return Response.json({ edit: result.edit });
});
