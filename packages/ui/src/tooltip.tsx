'use client';

import type { ReactNode } from 'react';
import { useId, useState } from 'react';
import { cx } from './cx';

/**
 * A short explanation that appears on hover and on focus (WP43). On focus matters: a tooltip
 * only a mouse can reach is one a keyboard user never sees.
 *
 * It describes rather than labels. Anything a control cannot be understood without belongs in
 * the control, not in here.
 */
export function Tooltip({
  text,
  children,
  className,
}: {
  text: string;
  children: ReactNode;
  className?: string;
}) {
  const id = useId();
  const [shown, setShown] = useState(false);
  return (
    <span
      className={cx('relative inline-flex', className)}
      onMouseEnter={() => setShown(true)}
      onMouseLeave={() => setShown(false)}
      onFocus={() => setShown(true)}
      onBlur={() => setShown(false)}
    >
      <span aria-describedby={shown ? id : undefined}>{children}</span>
      <span
        id={id}
        role="tooltip"
        className={cx(
          'pointer-events-none absolute bottom-full left-1/2 z-dropdown mb-2 w-max max-w-60',
          '-translate-x-1/2 rounded-lg border border-line bg-raised px-2.5 py-1.5',
          'text-caption leading-5 text-ink shadow-floating',
          'transition-opacity duration-fast ease-standard',
          shown ? 'opacity-100' : 'opacity-0',
        )}
      >
        {text}
      </span>
    </span>
  );
}
