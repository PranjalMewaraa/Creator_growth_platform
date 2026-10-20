import { ToastProvider } from '@cgp/ui';
import type { ReactNode } from 'react';
import { TopShellNav } from '@/components/top-shell-nav';
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
    <ToastProvider>
      <div className="min-h-screen bg-[#0a0a0c] text-ink antialiased">
        <TopShellNav workspace={workspace} workspaces={workspaces} user={user} />

        <main
          id="main"
          tabIndex={-1}
          className="w-full px-3 pb-24 pt-2 outline-none sm:px-6 lg:pb-8"
        >
          <div className="mx-auto max-w-[1600px]">{children}</div>
        </main>
      </div>
    </ToastProvider>
  );
}
