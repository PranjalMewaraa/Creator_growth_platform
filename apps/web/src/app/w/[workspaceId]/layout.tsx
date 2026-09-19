import { CoinsIcon, FilmIcon } from '@cgp/ui';
import Link from 'next/link';
import type { ComponentType, ReactNode, SVGProps } from 'react';
import { Logo } from '@/components/logo';
import { NavRail } from '@/components/nav-rail';
import { NewPostButton } from '@/components/new-post-button';
import { UserMenu } from '@/components/user-menu';
import { WorkspaceSwitcher } from '@/components/workspace-switcher';
import { requireWorkspace } from '@/server/session';

/** A balance as an icon chip; the balance is always in view (plan section 13). */
function Balance({
  label,
  value,
  hue,
  Icon,
}: {
  label: string;
  value: string;
  hue: string;
  Icon: ComponentType<SVGProps<SVGSVGElement>>;
}) {
  return (
    <span
      title={label}
      className="flex h-10 items-center gap-2 rounded-full border border-line bg-raised pl-1 pr-3.5"
    >
      <span
        className="grid size-8 place-items-center rounded-full"
        style={{ backgroundColor: `color-mix(in oklab, ${hue} 18%, transparent)`, color: hue }}
      >
        <Icon width={16} height={16} />
      </span>
      <span className="sr-only">{label}: </span>
      <span className="text-sm font-semibold tabular-nums text-ink">{value}</span>
    </span>
  );
}

export default async function WorkspaceLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  const { workspace, workspaces, user } = await requireWorkspace(workspaceId);

  return (
    <div className="min-h-screen bg-canvas">
      <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-line bg-canvas/85 pr-4 backdrop-blur sm:pr-6">
        {/* The logo sits over the rail, so the two read as one frame. */}
        <Link
          href={`/w/${workspace.id}`}
          aria-label="Home"
          className="flex h-16 shrink-0 items-center justify-center pl-4 lg:w-24 lg:pl-0"
        >
          <Logo compact />
        </Link>
        <WorkspaceSwitcher current={workspace} workspaces={workspaces} />

        <div className="ml-auto flex items-center gap-2">
          <NewPostButton workspaceId={workspace.id} />
          <span className="hidden items-center gap-2 sm:flex">
            <Balance
              label="Credits"
              value={workspace.creditBalance.toLocaleString('en-IN')}
              hue="#facc15"
              Icon={CoinsIcon}
            />
            <Balance
              label="Video seconds"
              value={String(workspace.videoSecondsBalance)}
              hue="#e879f9"
              Icon={FilmIcon}
            />
          </span>
          <UserMenu email={user.email} name={user.name} />
        </div>
      </header>

      <NavRail workspaceId={workspace.id} />

      <main className="px-4 pb-24 pt-6 sm:px-6 lg:pb-8 lg:pl-30">
        <div className="mx-auto max-w-[1400px]">{children}</div>
      </main>
    </div>
  );
}
