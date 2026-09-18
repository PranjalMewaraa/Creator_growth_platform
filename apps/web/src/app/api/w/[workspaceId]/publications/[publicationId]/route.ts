import { publicationView } from '@cgp/core';
import { apiError, apiWorkspace } from '@/server/api';
import { withRequestContext } from '@/server/request-context';
import { getDb } from '@/server/runtime';

type Context = { params: Promise<{ workspaceId: string; publicationId: string }> };

/** A publication and the status of each of its targets. */
export const GET = withRequestContext(async (_request: Request, { params }: Context) => {
  const { workspaceId, publicationId } = await params;
  const access = await apiWorkspace(workspaceId);
  if (!access.ok) return access.response;

  const publication = await publicationView(getDb(), workspaceId, publicationId);
  return publication ? Response.json({ publication }) : apiError(404, 'publication_not_found');
});
