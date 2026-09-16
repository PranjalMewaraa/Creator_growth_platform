'use client';

import { cx } from '@cgp/ui';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

/** The reduced destination set (plan section 13). Composer is a layer, not a destination. */
const DESTINATIONS = [
  { segment: '', label: 'Home' },
  { segment: 'studio', label: 'Studio' },
  { segment: 'calendar', label: 'Calendar' },
  { segment: 'brand', label: 'Brand' },
  { segment: 'accounts', label: 'Accounts' },
  { segment: 'insights', label: 'Insights' },
  { segment: 'settings', label: 'Settings' },
];

export function WorkspaceNav({ workspaceId }: { workspaceId: string }) {
  const pathname = usePathname();
  const base = `/w/${workspaceId}`;

  return (
    <nav aria-label="Workspace" className="min-w-0 overflow-x-auto">
      <ul className="flex w-max items-center gap-1 rounded-full border border-line bg-raised p-1">
        {DESTINATIONS.map(({ segment, label }) => {
          const href = segment ? `${base}/${segment}` : base;
          const active = segment ? pathname.startsWith(href) : pathname === href;
          return (
            <li key={label}>
              <Link
                href={href}
                aria-current={active ? 'page' : undefined}
                className={cx(
                  'block rounded-full px-4 py-1.5 text-sm transition',
                  active ? 'bg-ink font-medium text-canvas' : 'text-muted hover:text-ink',
                )}
              >
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
