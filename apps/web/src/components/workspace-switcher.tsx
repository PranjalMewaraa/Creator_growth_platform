import type { WorkspaceMembership } from '@cgp/db';
import { ChevronDownIcon, cx, PlusIcon } from '@cgp/ui';
import Link from 'next/link';
import { Popover } from './popover';

export function WorkspaceSwitcher({
  current,
  workspaces,
}: {
  current: { id: string; name: string };
  workspaces: WorkspaceMembership[];
}) {
  return (
    <Popover
      label="Switch workspace"
      trigger={
        <span className="flex h-10 max-w-52 items-center gap-2 rounded-full border border-line bg-raised pl-4 pr-3 text-sm font-medium text-ink hover:border-faint">
          <span className="truncate">{current.name}</span>
          <ChevronDownIcon className="shrink-0 text-faint transition group-open:rotate-180" />
        </span>
      }
    >
      <p className="px-3 pb-1 pt-2 text-xs text-faint">Workspaces</p>
      <ul>
        {workspaces.map((workspace) => (
          <li key={workspace.workspaceId}>
            <Link
              href={`/w/${workspace.workspaceId}`}
              aria-current={workspace.workspaceId === current.id ? 'true' : undefined}
              className={cx(
                'flex items-center justify-between gap-3 rounded-xl px-3 py-2 text-sm hover:bg-raised',
                workspace.workspaceId === current.id ? 'text-ink' : 'text-muted',
              )}
            >
              <span className="truncate">{workspace.name}</span>
              {workspace.workspaceId === current.id ? (
                <span className="size-1.5 shrink-0 rounded-full bg-accent" />
              ) : null}
            </Link>
          </li>
        ))}
      </ul>
      <div className="my-1.5 h-px bg-line" />
      <Link
        href="/setup"
        className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm text-muted hover:bg-raised hover:text-ink"
      >
        <PlusIcon />
        New workspace
      </Link>
    </Popover>
  );
}
