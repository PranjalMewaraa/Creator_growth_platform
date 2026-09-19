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
} from '@cgp/ui';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { CSSProperties, ComponentType, SVGProps } from 'react';

// The destinations (plan section 13) as a rail of colour coded icons: a vertical rail on wide
// screens, a bottom bar on phones. Composer is a layer, reached from New post, not a destination.

interface Destination {
  segment: string;
  label: string;
  hue: string;
  Icon: ComponentType<SVGProps<SVGSVGElement>>;
}

const DESTINATIONS: Destination[] = [
  { segment: '', label: 'Home', hue: '#a78bfa', Icon: HomeIcon },
  { segment: 'studio', label: 'Studio', hue: '#e879f9', Icon: SparklesIcon },
  { segment: 'calendar', label: 'Calendar', hue: '#fb923c', Icon: CalendarIcon },
  { segment: 'brand', label: 'Brand', hue: '#facc15', Icon: PaletteIcon },
  { segment: 'accounts', label: 'Accounts', hue: '#38bdf8', Icon: LinkIcon },
  { segment: 'insights', label: 'Insights', hue: '#34d399', Icon: ChartIcon },
  { segment: 'settings', label: 'Settings', hue: '#fb7185', Icon: GearIcon },
];

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
  const { label, hue, Icon } = destination;
  const style = {
    '--hue': hue,
    backgroundColor: active ? hue : `color-mix(in oklab, ${hue} 14%, transparent)`,
    color: active ? '#15120a' : hue,
    boxShadow: active
      ? `0 0 0 1px color-mix(in oklab, ${hue} 60%, transparent), 0 10px 30px -8px ${hue}`
      : undefined,
  } as CSSProperties;

  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      aria-label={label}
      className={cx(
        'group relative grid place-items-center rounded-2xl transition hover:scale-105',
        vertical ? 'size-12' : 'size-11',
      )}
      style={style}
    >
      <Icon width={22} height={22} />
      {vertical ? (
        // Names on hover, so the rail stays quiet.
        <span className="pointer-events-none absolute left-full ml-3 whitespace-nowrap rounded-lg border border-line bg-raised px-2.5 py-1 text-xs font-medium text-ink opacity-0 shadow-xl transition group-hover:opacity-100 group-focus-visible:opacity-100">
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
        className="fixed bottom-0 left-0 top-16 z-10 hidden w-24 flex-col items-center gap-3 border-r border-line bg-canvas/80 pt-6 backdrop-blur lg:flex"
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
