import { Stat } from '@cgp/ui';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Logo } from '@/components/logo';
import { UserMenu } from '@/components/user-menu';
import { WorkspaceNav } from '@/components/workspace-nav';
import { WorkspaceSwitcher } from '@/components/workspace-switcher';
import { requireWorkspace } from '@/server/session';

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
      <header className="sticky top-0 z-10 border-b border-line bg-canvas/85 backdrop-blur">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-3 px-4 py-3 sm:px-6 xl:flex-nowrap">
          <div className="flex items-center gap-3">
            <Link
              href={`/w/${workspace.id}`}
              aria-label="Home"
              className="flex h-10 items-center rounded-full border border-line bg-raised px-1 sm:pr-4"
            >
              <Logo compact className="sm:hidden" />
              <Logo className="hidden sm:flex" />
            </Link>
            <WorkspaceSwitcher current={workspace} workspaces={workspaces} />
          </div>

          <div className="order-last flex w-full justify-center xl:order-none xl:w-auto xl:flex-1">
            <WorkspaceNav workspaceId={workspace.id} />
          </div>

          <div className="ml-auto flex items-center gap-2">
            <Stat label="Credits" value={workspace.creditBalance.toLocaleString('en-IN')} />
            <Stat label="Video sec" value={String(workspace.videoSecondsBalance)} />
            <UserMenu email={user.email} name={user.name} />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6">{children}</main>
    </div>
  );
}
