import { listAccounts } from '@cgp/core';
import { apiWorkspace } from '@/server/api';
import { withRequestContext } from '@/server/request-context';
import { getDb } from '@/server/runtime';

type Context = { params: Promise<{ workspaceId: string }> };

/** Connected social accounts. Tokens never leave the database, encrypted or not. */
export const GET = withRequestContext(async (_request: Request, { params }: Context) => {
  const { workspaceId } = await params;
  const access = await apiWorkspace(workspaceId);
  if (!access.ok) return access.response;
  return Response.json({ accounts: await listAccounts(getDb(), workspaceId) });
});
