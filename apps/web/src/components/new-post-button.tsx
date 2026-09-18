'use client';

import { PlusIcon } from '@cgp/ui';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

/** Hidden on the composer itself, where it would only repeat the screen you are on. */
export function NewPostButton({ workspaceId }: { workspaceId: string }) {
  const href = `/w/${workspaceId}/compose`;
  if (usePathname().startsWith(href)) return null;
  return (
    <Link
      href={href}
      className="inline-flex h-10 items-center gap-1.5 rounded-full bg-accent px-4 text-sm font-medium text-accent-ink transition hover:brightness-105"
    >
      <PlusIcon />
      New post
    </Link>
  );
}
