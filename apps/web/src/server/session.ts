import 'server-only';
import { findMembership, listWorkspacesForUser, scoped, type WorkspaceMembership } from '@cgp/db';
import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { cache } from 'react';
import { getAuth } from './auth';
import { getDb } from './runtime';

export interface SignedInUser {
  id: string;
  email: string;
  name: string;
}

// cache(): the layout and the page both ask, so each request looks the session up once.
export const currentUser = cache(async (): Promise<SignedInUser | null> => {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session?.user) return null;
  const { id, email, name } = session.user;
  return { id, email, name };
});

export async function requireUser(): Promise<SignedInUser> {
  const user = await currentUser();
  if (!user) redirect('/sign-in');
  return user;
}

export interface WorkspaceContext {
  user: SignedInUser;
  membership: WorkspaceMembership;
  workspace: {
    id: string;
    name: string;
    timezone: string;
    creditBalance: number;
    videoSecondsBalance: number;
  };
  /** Every workspace this user can open, for the switcher. */
  workspaces: WorkspaceMembership[];
}

/**
 * The single gate on tenant data in the web app: without a membership the workspace does not
 * exist as far as this user is concerned, so it answers 404 rather than 403.
 */
export const requireWorkspace = cache(async (workspaceId: string): Promise<WorkspaceContext> => {
  const user = await requireUser();
  const db = getDb();

  const membership = await findMembership(db, user.id, workspaceId);
  if (!membership) notFound();

  const workspace = await scoped(db, workspaceId).workspace();
  if (!workspace) notFound();

  return {
    user,
    membership,
    workspace: {
      id: workspace.id,
      name: workspace.name,
      timezone: workspace.timezone,
      creditBalance: workspace.creditBalance,
      videoSecondsBalance: workspace.videoSecondsBalance,
    },
    workspaces: await listWorkspacesForUser(db, user.id),
  };
});
