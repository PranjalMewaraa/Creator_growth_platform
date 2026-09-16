'use client';

import { cx } from '@cgp/ui';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, type ReactNode } from 'react';

/**
 * A disclosure built on <details>, so it works before hydration and is keyboard accessible.
 * Closes on navigation, on an outside click and on Escape.
 */
export function Popover({
  trigger,
  label,
  align = 'left',
  children,
}: {
  trigger: ReactNode;
  label: string;
  align?: 'left' | 'right';
  children: ReactNode;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  const pathname = usePathname();

  useEffect(() => {
    if (ref.current) ref.current.open = false;
  }, [pathname]);

  useEffect(() => {
    const close = (event: Event) => {
      const details = ref.current;
      if (!details?.open) return;
      if (
        event instanceof KeyboardEvent
          ? event.key === 'Escape'
          : !details.contains(event.target as Node)
      ) {
        details.open = false;
      }
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', close);
    };
  }, []);

  return (
    <details ref={ref} className="group relative">
      <summary
        aria-label={label}
        className="flex cursor-pointer list-none items-center [&::-webkit-details-marker]:hidden"
      >
        {trigger}
      </summary>
      <div
        className={cx(
          'absolute top-full z-20 mt-2 min-w-56 rounded-2xl border border-line bg-surface p-1.5 shadow-2xl shadow-black/60',
          align === 'right' ? 'right-0' : 'left-0',
        )}
      >
        {children}
      </div>
    </details>
  );
}
