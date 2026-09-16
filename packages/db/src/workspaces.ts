import { unwrap, type Database, type Drizzle } from './client';
import { memberships, workspaces } from './schema';

export interface NewWorkspace {
  name: string;
  timezone?: string;
  ownerUserId: string;
}

export async function createWorkspaceIn(
  tx: Drizzle,
  { name, timezone, ownerUserId }: NewWorkspace,
): Promise<typeof workspaces.$inferSelect> {
  const [workspace] = await tx
    .insert(workspaces)
    .values({ name, ...(timezone ? { timezone } : {}) })
    .returning();
  if (!workspace) throw new Error('Workspace insert returned no row');
  await tx
    .insert(memberships)
    .values({ workspaceId: workspace.id, userId: ownerUserId, role: 'owner' });
  return workspace;
}

/**
 * Creating a tenant is the one write that cannot be scoped, because the workspace does not
 * exist yet. The owner membership lands in the same transaction.
 */
export function createWorkspace(
  db: Database,
  workspace: NewWorkspace,
): Promise<typeof workspaces.$inferSelect> {
  return unwrap(db).transaction((tx) => createWorkspaceIn(tx, workspace));
}
