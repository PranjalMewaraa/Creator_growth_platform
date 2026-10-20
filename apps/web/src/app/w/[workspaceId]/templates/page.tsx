import { EmptyState, TemplateIcon } from '@cgp/ui';
import { Screen } from '@/components/screen';
import { requireWorkspace } from '@/server/session';

export const metadata = { title: 'Templates' };

/** Templates: its own rail stop now, ahead of the library it will hold — Studio's existing
 *  per-generator template picker is the real thing today; this page is where adding, browsing
 *  and managing templates directly will live once that's built. */
export default async function TemplatesPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  await requireWorkspace(workspaceId);

  return (
    <Screen title="Templates" description="Your template library.">
      <div className="rounded-2xl border border-line bg-surface">
        <EmptyState
          title="Coming soon"
          description="Adding and managing templates here directly is on its way. For now, pick a template from within Studio's own prompt box when you generate."
          action={
            <span className="flex items-center gap-1.5 text-sm text-faint">
              <TemplateIcon width={16} height={16} aria-hidden />
              Template library
            </span>
          }
        />
      </div>
    </Screen>
  );
}
