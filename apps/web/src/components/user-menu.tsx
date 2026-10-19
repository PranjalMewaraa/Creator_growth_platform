'use client';

import { ChartIcon, GearIcon, LinkIcon, LogOutIcon, PaletteIcon, SyncIcon } from '@cgp/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { authClient } from '@/lib/auth-client';
import { Popover } from './popover';

// The account menu (WP64 reskin): the rail only holds the five everyday work surfaces now
// (Assets, Studio, Storyboard, Scheduler, Trends), so Brand, Accounts, Sync centre and
// Insights live here instead of disappearing — still one tap away, just not competing with
// daily work for rail space.
const ACCOUNT_LINKS = [
  { segment: 'brand', label: 'Brand', Icon: PaletteIcon },
  { segment: 'accounts', label: 'Accounts', Icon: LinkIcon },
  { segment: 'sync', label: 'Sync centre', Icon: SyncIcon },
  { segment: 'insights', label: 'Insights', Icon: ChartIcon },
  { segment: 'settings', label: 'Settings', Icon: GearIcon },
];

export function UserMenu({
  workspaceId,
  email,
  name,
}: {
  workspaceId: string;
  email: string;
  name: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const initial = (name || email).trim().charAt(0).toUpperCase();

  return (
    <Popover
      label="Account"
      align="right"
      trigger={
        <span className="grid size-10 place-items-center rounded-full bg-gradient-to-br from-accent to-hot text-sm font-semibold text-accent-ink ring-2 ring-line">
          {initial}
        </span>
      }
    >
      <div className="px-3 pb-2 pt-2">
        <p className="truncate text-sm font-medium text-ink">{name}</p>
        <p className="truncate text-xs text-faint">{email}</p>
      </div>
      <div className="my-1 h-px bg-line" />
      {ACCOUNT_LINKS.map(({ segment, label, Icon }) => (
        <Link
          key={segment}
          href={`/w/${workspaceId}/${segment}`}
          className="flex min-h-11 w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-muted hover:bg-raised hover:text-ink"
        >
          <Icon />
          {label}
        </Link>
      ))}
      <div className="my-1 h-px bg-line" />
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          setPending(true);
          void authClient.signOut().then(() => router.push('/sign-in'));
        }}
        className="flex min-h-11 w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-muted hover:bg-raised hover:text-ink disabled:opacity-60"
      >
        <LogOutIcon />
        {pending ? 'Signing out' : 'Sign out'}
      </button>
    </Popover>
  );
}
