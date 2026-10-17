import { listWorkspacesForUser } from '@cgp/db';
import { redirect } from 'next/navigation';
import { getDb } from '@/server/runtime';
import { requireUser } from '@/server/session';

/**
 * No dynamic route segment, so Next tries to prerender this at build time unless told not to.
 * `requireUser` reaches `getAuth()` before it reaches `headers()` (argument evaluation order:
 * the callee runs first), so a build with no DATABASE_URL/REDIS_URL/AUTH_SECRET set throws
 * while prerendering instead of Next ever seeing the dynamic API call that would have opted
 * this route out on its own. Forcing it here means a misconfigured env fails the request, not
 * the build.
 */
export const dynamic = 'force-dynamic';

/** Sends a signed in user to their workspace, or to setup if they have none yet. */
export default async function RootPage() {
  const user = await requireUser();
  const [first] = await listWorkspacesForUser(getDb(), user.id);
  redirect(first ? `/w/${first.workspaceId}` : '/setup');
}
