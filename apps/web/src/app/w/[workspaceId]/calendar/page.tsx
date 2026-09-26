import { listAccounts } from '@cgp/core';
import { listArt } from '@/server/art';
import { getDb } from '@/server/runtime';
import { requireWorkspace } from '@/server/session';
import { CalendarLoader } from './calendar-loader';

/**
 * S-07, calendar week view (WP34). The channels come from the server; the week itself is
 * fetched in the browser, because which week it is depends on the viewer's own clock.
 */
export default async function CalendarPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  const { workspace } = await requireWorkspace(workspaceId);
  const accounts = await listAccounts(getDb(), workspaceId);

  return (
    <CalendarLoader
      workspaceId={workspaceId}
      workspaceName={workspace.name}
      timezone={workspace.timezone}
      accounts={accounts.map(({ id, platform, displayName }) => ({ id, platform, displayName }))}
      art={listArt()}
    />
  );
}
