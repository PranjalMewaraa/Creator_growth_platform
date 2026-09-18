import 'server-only';
import { findMembership, type WorkspaceMembership } from '@cgp/db';
import { currentUser, type SignedInUser } from './session';
import { getDb } from './runtime';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A JSON error body every API route shares: a stable code, then any detail. */
export function apiError(status: number, code: string, detail: Record<string, unknown> = {}) {
  return Response.json({ error: { code, ...detail } }, { status });
}

export type ApiWorkspace =
  | { ok: true; user: SignedInUser; membership: WorkspaceMembership }
  | { ok: false; response: Response };

/**
 * The API's version of requireWorkspace: a JSON 401 or 404 instead of a redirect. Without a
 * membership the workspace does not exist as far as this user is concerned, hence 404.
 */
export async function apiWorkspace(workspaceId: string): Promise<ApiWorkspace> {
  const user = await currentUser();
  if (!user) return { ok: false, response: apiError(401, 'unauthenticated') };
  // Ids arrive from URLs; a malformed one is simply not found, never a database error.
  const membership = UUID.test(workspaceId)
    ? await findMembership(getDb(), user.id, workspaceId)
    : undefined;
  if (!membership) return { ok: false, response: apiError(404, 'workspace_not_found') };
  return { ok: true, user, membership };
}

/** The request body as JSON, or undefined when it is missing or malformed. */
export async function jsonBody(request: Request): Promise<unknown> {
  try {
    return (await request.json()) as unknown;
  } catch {
    return undefined;
  }
}
