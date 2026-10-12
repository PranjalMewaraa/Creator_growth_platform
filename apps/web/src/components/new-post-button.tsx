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
      aria-label="New post"
      className="inline-flex h-11 items-center gap-1.5 rounded-full bg-accent px-3.5 text-sm font-medium text-accent-ink shadow-[0_8px_24px_-10px_var(--color-accent)] transition hover:brightness-105 sm:px-4"
    >
      <PlusIcon />
      <span className="hidden sm:inline">New post</span>
    </Link>
  );
}
