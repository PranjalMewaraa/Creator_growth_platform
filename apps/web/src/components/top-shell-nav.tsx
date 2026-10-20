'use client';

import type { WorkspaceMembership } from '@cgp/db';
import { cx } from '@cgp/ui';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { authClient } from '@/lib/auth-client';
import { Popover } from './popover';

interface TopShellNavProps {
  workspace: {
    id: string;
    name: string;
    creditBalance: number;
    videoSecondsBalance: number;
  };
  workspaces: WorkspaceMembership[];
  user: {
    id: string;
    email: string;
    name: string;
  };
}

interface NavTab {
  key: string;
  label: string;
  getHref: (wsId: string) => string;
  isActive: (pathname: string, searchParams: URLSearchParams) => boolean;
}

// Exactly this list, in this order (requested directly, overriding whatever the Orbis
// reference showed): Studio, Marketing, Templates, Storyboard, Timeline, Assets, Settings.
// Video, Audio and Canvas were never asked for — Video lives inside Studio's own kind
// switcher, Audio has no feature behind it yet, and Canvas duplicated Brand (already in the
// account menu below).
const NAV_TABS: NavTab[] = [
  {
    key: 'studio',
    label: 'Studio',
    getHref: (id) => `/w/${id}/studio`,
    isActive: (pathname) => pathname.includes('/studio'),
  },
  {
    key: 'marketing',
    label: 'Marketing',
    getHref: (id) => `/w/${id}/trends`,
    isActive: (pathname) => pathname.includes('/trends'),
  },
  {
    key: 'templates',
    label: 'Templates',
    getHref: (id) => `/w/${id}/templates`,
    isActive: (pathname) => pathname.includes('/templates'),
  },
  {
    key: 'storyboard',
    label: 'Storyboard',
    getHref: (id) => `/w/${id}/storyboard`,
    isActive: (pathname) => pathname.includes('/storyboard'),
  },
  {
    key: 'timeline',
    label: 'Timeline',
    getHref: (id) => `/w/${id}/calendar`,
    isActive: (pathname) => pathname.includes('/calendar'),
  },
  {
    key: 'assets',
    label: 'Assets',
    getHref: (id) => `/w/${id}/assets`,
    isActive: (pathname) => pathname.includes('/assets'),
  },
  {
    key: 'settings',
    label: 'Settings',
    getHref: (id) => `/w/${id}/settings`,
    isActive: (pathname) => pathname.includes('/settings'),
  },
];

function NavTabsRow({ workspaceId }: { workspaceId: string }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  return (
    <nav
      aria-label="Primary Navigation"
      className="flex items-center gap-0.5 rounded-full border border-[#272832] bg-[#141519]/90 px-1 py-0.5 shadow-lg shadow-black/40 backdrop-blur-xl"
    >
      {NAV_TABS.map((tab) => {
        const active = tab.isActive(pathname, searchParams);
        const href = tab.getHref(workspaceId);

        return (
          <Link
            key={tab.key}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={cx(
              'rounded-full px-2.5 py-1 text-[11.5px] font-normal tracking-tight transition-all duration-150 select-none whitespace-nowrap',
              active
                ? 'bg-[#25262f] text-white font-medium shadow-sm ring-1 ring-white/10'
                : 'text-[#858793] hover:text-[#f4f4f5] hover:bg-white/5',
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function TopShellNav({ workspace, workspaces, user }: TopShellNavProps) {
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);
  const initial = (user.name || user.email || 'U').trim().charAt(0).toUpperCase();

  // Balance display formatted with small thin font
  const creditsFormatted = workspace.creditBalance.toLocaleString('en-IN');

  return (
    <header className="sticky top-0 z-30 flex h-14 w-full items-center justify-between border-b border-white/[0.04] bg-[#0a0a0c]/60 px-3 sm:px-6 backdrop-blur-md transition-all">
      {/* Skip link for accessibility */}
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-3 focus:z-50 focus:inline-flex focus:h-8 focus:items-center focus:rounded-full focus:bg-[#2ef07a] focus:px-3 focus:text-xs focus:font-medium focus:text-black"
      >
        Skip to content
      </a>

      {/* LEFT: app title, then the workspace switcher */}
      <div className="flex items-center gap-2 shrink-0">
        <Link
          href={`/w/${workspace.id}`}
          aria-label="Home"
          className="px-1 text-[13px] font-semibold tracking-tight text-white hover:text-white/80 transition-colors select-none"
        >
          Morphious
        </Link>
        <Popover
          label="Switch workspace"
          trigger={
            <div
              role="button"
              tabIndex={0}
              className="flex h-8 items-center gap-2 rounded-full border border-[#272832] bg-[#141519]/90 pl-3 pr-2.5 text-[11.5px] font-normal text-white shadow-sm transition-colors hover:border-[#3a3b48] hover:bg-[#1a1b22] select-none"
            >
              <span className="size-2 rounded-full bg-[#10b981] shadow-[0_0_8px_#10b981] shrink-0 inline-block animate-pulse" />
              <span className="font-medium tracking-tight text-white max-w-36 truncate">
                {workspace.name || 'Orbis'}
              </span>
              <svg
                width="9"
                height="9"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="opacity-50 shrink-0"
              >
                <path d="m6 9 6 6 6-6" />
              </svg>
            </div>
          }
        >
          <div className="p-1">
            <p className="px-3 pb-1 pt-1.5 text-[10px] font-normal uppercase tracking-wider text-[#6f717d]">
              Workspaces
            </p>
            <ul className="flex flex-col gap-0.5">
              {workspaces.map((ws) => (
                <li key={ws.workspaceId}>
                  <Link
                    href={`/w/${ws.workspaceId}/studio`}
                    aria-current={ws.workspaceId === workspace.id ? 'true' : undefined}
                    className={cx(
                      'flex min-h-8 items-center justify-between gap-3 rounded-lg px-2.5 py-1.5 text-xs transition-colors',
                      ws.workspaceId === workspace.id
                        ? 'bg-[#25262f] text-white font-medium'
                        : 'text-[#9ea0ac] hover:bg-[#1c1d24] hover:text-white',
                    )}
                  >
                    <span className="truncate">{ws.name}</span>
                    {ws.workspaceId === workspace.id && (
                      <span className="size-1.5 shrink-0 rounded-full bg-[#10b981]" />
                    )}
                  </Link>
                </li>
              ))}
            </ul>
            <div className="my-1 h-px bg-[#26272f]" />
            <Link
              href="/setup"
              className="flex min-h-8 items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs text-[#9ea0ac] hover:bg-[#1c1d24] hover:text-white transition-colors"
            >
              <span className="text-sm font-semibold leading-none">+</span>
              <span>New workspace</span>
            </Link>
          </div>
        </Popover>
      </div>

      {/* CENTER: Floating Capsule Pill Nav Bar matching reference UI */}
      <div className="hidden md:flex items-center justify-center overflow-x-auto no-scrollbar mx-2">
        <Suspense fallback={null}>
          <NavTabsRow workspaceId={workspace.id} />
        </Suspense>
      </div>

      {/* RIGHT: Status Badge Pill + Account Menu matching reference UI */}
      <div className="flex items-center gap-2 shrink-0">
        {/* Sleek Pill Badge: "(dot) $57.55 this month   local studio" */}
        <div className="flex h-8 items-center gap-2 rounded-full border border-[#272832] bg-[#141519]/90 px-3 text-[11px] font-normal text-white shadow-sm select-none">
          <span className="size-1.5 rounded-full bg-[#10b981] shadow-[0_0_6px_#10b981] shrink-0" />
          <span className="font-mono tabular-nums text-zinc-300 font-normal">
            {creditsFormatted} credits
          </span>
          <span className="text-[#3b3d4a]">•</span>
          <span className="text-zinc-400 font-normal hidden sm:inline max-w-28 truncate">
            {workspace.name.toLowerCase()}
          </span>
        </div>

        {/* User Profile Avatar Popover */}
        <Popover
          label="Account menu"
          align="right"
          trigger={
            <div
              role="button"
              tabIndex={0}
              className="grid size-8 place-items-center rounded-full bg-gradient-to-br from-[#272832] to-[#1c1d24] text-[11px] font-medium text-white ring-1 ring-[#3a3b46] hover:ring-[#4e5060] transition select-none"
            >
              {initial}
            </div>
          }
        >
          <div className="p-1">
            <div className="px-3 pb-2 pt-1.5">
              <p className="truncate text-xs font-medium text-white">{user.name}</p>
              <p className="truncate text-[10px] text-[#71737f]">{user.email}</p>
            </div>
            <div className="my-1 h-px bg-[#26272f]" />
            <Link
              href={`/w/${workspace.id}/brand`}
              className="flex min-h-8 w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-[#9ea0ac] hover:bg-[#1c1d24] hover:text-white transition-colors"
            >
              Brand Kit &amp; Canvas
            </Link>
            <Link
              href={`/w/${workspace.id}/accounts`}
              className="flex min-h-8 w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-[#9ea0ac] hover:bg-[#1c1d24] hover:text-white transition-colors"
            >
              Social Accounts
            </Link>
            <Link
              href={`/w/${workspace.id}/sync`}
              className="flex min-h-8 w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-[#9ea0ac] hover:bg-[#1c1d24] hover:text-white transition-colors"
            >
              Sync Centre
            </Link>
            <Link
              href={`/w/${workspace.id}/insights`}
              className="flex min-h-8 w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-[#9ea0ac] hover:bg-[#1c1d24] hover:text-white transition-colors"
            >
              Insights &amp; Analytics
            </Link>
            <div className="my-1 h-px bg-[#26272f]" />
            <button
              type="button"
              disabled={signingOut}
              onClick={() => {
                setSigningOut(true);
                void authClient.signOut().then(() => router.push('/sign-in'));
              }}
              className="flex min-h-8 w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-[#ff7a7a] hover:bg-[#2a1717] transition-colors disabled:opacity-50"
            >
              {signingOut ? 'Signing out…' : 'Sign out'}
            </button>
          </div>
        </Popover>
      </div>

      {/* Mobile Nav Drawer Bar: Visible on small screens below header */}
      <div className="fixed inset-x-0 bottom-0 z-30 flex md:hidden items-center gap-1 overflow-x-auto no-scrollbar border-t border-[#202128] bg-[#0e0f12]/95 px-2 py-1.5 backdrop-blur-xl">
        {NAV_TABS.map((tab) => {
          const href = tab.getHref(workspace.id);
          return (
            <Link
              key={tab.key}
              href={href}
              className="shrink-0 px-2 py-1 text-[11px] font-normal text-[#8a8c98] hover:text-white"
            >
              {tab.label}
            </Link>
          );
        })}
      </div>
    </header>
  );
}
