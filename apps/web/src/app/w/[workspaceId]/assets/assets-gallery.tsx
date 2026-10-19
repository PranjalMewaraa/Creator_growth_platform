'use client';

import { GalleryFeed } from '@/components/gallery-feed';
import { useRouter } from 'next/navigation';

/** Assets (WP64): the same feed Studio shows on its own canvas, as a page of its own — a
 *  library of everything the workspace has generated, opened into Studio to view or redo. */
export function AssetsGallery({ workspaceId }: { workspaceId: string }) {
  const router = useRouter();
  return (
    <GalleryFeed
      workspaceId={workspaceId}
      onOpen={(jobId) => router.push(`/w/${workspaceId}/studio?job=${jobId}`)}
    />
  );
}
