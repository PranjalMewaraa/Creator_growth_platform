import { saveTextLayer } from '@cgp/core';
import { apiWorkspace, refusal } from '@/server/api';
import { withRequestContext } from '@/server/request-context';
import { getDb } from '@/server/runtime';
import { getProviders } from '@/server/providers';

type Context = { params: Promise<{ workspaceId: string; outputId: string }> };

/**
 * Composites a text layer over a generated picture and keeps it as that output's rendition
 * (invariant 12). Sending a new spec replaces the last one; the picture underneath is never
 * changed, so the layer can always be redone.
 */
export const PUT = withRequestContext(async (request: Request, { params }: Context) => {
  const { workspaceId, outputId } = await params;
  const access = await apiWorkspace(workspaceId);
  if (!access.ok) return access.response;

  const body: unknown = await request.json().catch(() => undefined);
  const spec = (body as { spec?: unknown } | undefined)?.spec;
  const result = await saveTextLayer(
    { db: getDb(), store: getProviders().store },
    workspaceId,
    outputId,
    spec,
  );
  if (!result.ok) return refusal(result);
  return Response.json({ rendition: result.rendition });
});
