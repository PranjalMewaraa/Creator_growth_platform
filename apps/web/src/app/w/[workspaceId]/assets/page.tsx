import { Screen } from '@/components/screen';
import { requireWorkspace } from '@/server/session';
import { AssetsGallery } from './assets-gallery';

export const metadata = { title: 'Assets' };

/** Assets (WP64 reskin): the workspace's own library of generations, newest first, in a
 *  Pinterest-style feed — the same tiles Studio's canvas shows, as a destination of its own. */
export default async function AssetsPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  await requireWorkspace(workspaceId);

  return (
    <Screen title="Assets" description="Everything this workspace has generated, newest first.">
      <AssetsGallery workspaceId={workspaceId} />
    </Screen>
  );
}
