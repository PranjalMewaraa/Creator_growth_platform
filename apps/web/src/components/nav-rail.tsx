'use client';

import {
  CalendarIcon,
  ChartIcon,
  cx,
  GearIcon,
  HomeIcon,
  LinkIcon,
  PaletteIcon,
  SparklesIcon,
  SyncIcon,
  TrendIcon,
} from '@cgp/ui';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ComponentType, SVGProps } from 'react';

// The destinations (plan section 13): a vertical rail on wide screens, a bottom bar on
// phones. Composer is a layer, reached from New post, not a destination.

interface Destination {
  segment: string;
  label: string;
  Icon: ComponentType<SVGProps<SVGSVGElement>>;
}

const DESTINATIONS: Destination[] = [
  { segment: '', label: 'Home', Icon: HomeIcon },
  { segment: 'studio', label: 'Studio', Icon: SparklesIcon },
  { segment: 'trends', label: 'Trends', Icon: TrendIcon },
  { segment: 'calendar', label: 'Calendar', Icon: CalendarIcon },
  { segment: 'brand', label: 'Brand', Icon: PaletteIcon },
  { segment: 'accounts', label: 'Accounts', Icon: LinkIcon },
  { segment: 'sync', label: 'Sync centre', Icon: SyncIcon },
  { segment: 'insights', label: 'Insights', Icon: ChartIcon },
  { segment: 'settings', label: 'Settings', Icon: GearIcon },
];

/**
 * Minimal rail (WP53): a hue per destination used to be the rail's whole idea, eight
 * differently tinted pills competing for the eye before anyone had picked anything. One hue
 * now does the work the eight did — on the single item that is actually active — and every
 * icon rests at the same quiet grey the rest of the time. The hue is the chrome's own blue
 * neon (`neon-glow`), not the yellow accent: this marks where you are, not a thing to do,
 * and the product has exactly one of those. No `hover:scale-105` either: the plan rules
 * scale transforms out as reading cheap, and this rail had been the one place still doing it.
 */
function Item({
  href,
  active,
  destination,
  vertical,
}: {
  href: string;
  active: boolean;
  destination: Destination;
  vertical: boolean;
}) {
  const { label, Icon } = destination;

  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      aria-label={label}
      className={cx(
        'group relative grid size-11 place-items-center rounded-xl transition-colors duration-base ease-standard',
        active ? 'neon-glow bg-neon/15 text-neon-hot' : 'text-faint hover:bg-raised hover:text-ink',
      )}
    >
      <Icon width={20} height={20} />
      {vertical ? (
        // Names on hover, so the rail stays quiet.
        <span className="pointer-events-none absolute left-full ml-3 whitespace-nowrap rounded-lg border border-line bg-raised px-2.5 py-1 text-xs font-medium text-ink opacity-0 shadow-floating transition-opacity duration-base ease-standard group-hover:opacity-100 group-focus-visible:opacity-100">
          {label}
        </span>
      ) : null}
    </Link>
  );
}

export function NavRail({ workspaceId }: { workspaceId: string }) {
  const pathname = usePathname();
  const base = `/w/${workspaceId}`;
  const items = DESTINATIONS.map((destination) => {
    const href = destination.segment ? `${base}/${destination.segment}` : base;
    const active = destination.segment ? pathname.startsWith(href) : pathname === href;
    return { destination, href, active };
  });

  return (
    <>
      <nav
        aria-label="Workspace"
        className="fixed bottom-0 left-0 top-16 z-10 hidden w-18 flex-col items-center gap-1.5 border-r border-line bg-canvas/80 pt-5 backdrop-blur lg:flex"
      >
        {items.map(({ destination, href, active }) => (
          <Item
            key={destination.label}
            href={href}
            active={active}
            destination={destination}
            vertical
          />
        ))}
      </nav>
      <nav
        aria-label="Workspace"
        className="fixed inset-x-0 bottom-0 z-20 flex justify-around border-t border-line bg-canvas/90 px-2 py-2 backdrop-blur lg:hidden"
      >
        {items.map(({ destination, href, active }) => (
          <Item
            key={destination.label}
            href={href}
            active={active}
            destination={destination}
            vertical={false}
          />
        ))}
      </nav>
    </>
  );
}
