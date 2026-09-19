import { listAccounts, profileHistory } from '@cgp/core';
import { listArt } from '@/server/art';
import { getDb } from '@/server/runtime';
import { requireWorkspace } from '@/server/session';
import { CalendarLoader } from './calendar-loader';

/**
 * S-07, calendar week view. A visual preview for now: the channels and settings are real, the
 * posts on the grid are samples until scheduling lands (WP31, WP34).
 */
export default async function CalendarPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  const { workspace } = await requireWorkspace(workspaceId);
  const db = getDb();
  const [accounts, [profile]] = await Promise.all([
    listAccounts(db, workspaceId),
    profileHistory(db, workspaceId),
  ]);

  return (
    <CalendarLoader
      workspaceId={workspaceId}
      workspaceName={workspace.name}
      timezone={workspace.timezone}
      cadence={profile?.profile.cadence ?? null}
      accounts={accounts.map(({ id, platform, displayName }) => ({ id, platform, displayName }))}
      art={listArt()}
    />
  );
}
