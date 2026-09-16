import type { MembershipRole } from '@cgp/contracts';
import { and, eq } from 'drizzle-orm';
import { unwrap, type Database } from './client';
import { memberships, workspaces } from './schema';

export interface WorkspaceMembership {
  workspaceId: string;
  name: string;
  role: MembershipRole;
}

/**
 * Scoped by user rather than by workspace: this is what decides which workspaces a signed in
 * user may open, so it is the one read that legitimately crosses workspaces.
 */
export function listWorkspacesForUser(
  db: Database,
  userId: string,
): Promise<WorkspaceMembership[]> {
  return unwrap(db)
    .select({
      workspaceId: workspaces.id,
      name: workspaces.name,
      role: memberships.role,
    })
    .from(memberships)
    .innerJoin(workspaces, eq(workspaces.id, memberships.workspaceId))
    .where(eq(memberships.userId, userId))
    .orderBy(workspaces.name);
}

export async function findMembership(
  db: Database,
  userId: string,
  workspaceId: string,
): Promise<WorkspaceMembership | undefined> {
  const [row] = await unwrap(db)
    .select({ workspaceId: workspaces.id, name: workspaces.name, role: memberships.role })
    .from(memberships)
    .innerJoin(workspaces, eq(workspaces.id, memberships.workspaceId))
    .where(and(eq(memberships.userId, userId), eq(memberships.workspaceId, workspaceId)));
  return row;
}
