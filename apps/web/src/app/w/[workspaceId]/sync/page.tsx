import { requireWorkspace } from '@/server/session';
import { SyncCentre } from './sync-centre';

/**
 * S-20, the Sync centre (WP35). The list is fetched in the browser and kept fresh, because
 * what it shows changes while it is open: a target claimed, a retry coming back, a platform
 * answering at last.
 */
export const metadata = { title: 'Sync centre' };

export default async function SyncPage({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  await requireWorkspace(workspaceId);
  return <SyncCentre workspaceId={workspaceId} />;
}
