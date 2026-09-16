'use client';

import { LogOutIcon } from '@cgp/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { authClient } from '@/lib/auth-client';
import { Popover } from './popover';

export function UserMenu({ email, name }: { email: string; name: string }) {
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
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          setPending(true);
          void authClient.signOut().then(() => router.push('/sign-in'));
        }}
        className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-muted hover:bg-raised hover:text-ink disabled:opacity-60"
      >
        <LogOutIcon />
        {pending ? 'Signing out' : 'Sign out'}
      </button>
    </Popover>
  );
}
