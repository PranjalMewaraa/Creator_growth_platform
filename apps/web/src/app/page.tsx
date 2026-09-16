import { listWorkspacesForUser } from '@cgp/db';
import { redirect } from 'next/navigation';
import { getDb } from '@/server/runtime';
import { requireUser } from '@/server/session';

/** Sends a signed in user to their workspace, or to setup if they have none yet. */
export default async function RootPage() {
  const user = await requireUser();
  const [first] = await listWorkspacesForUser(getDb(), user.id);
  redirect(first ? `/w/${first.workspaceId}` : '/setup');
}
