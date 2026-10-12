'use client';

import type { ReactNode } from 'react';
import { cx } from './cx';

/**
 * A small set of mutually exclusive choices, all visible at once (WP43): scene counts, image
 * counts, an Instagram frame. Radios underneath, because that is what this is, and a radio
 * group gets arrow keys and a single tab stop from the browser for free.
 */
export function SegmentedControl<T extends string | number>({
  name,
  options,
  value,
  onChange,
  label,
  className,
}: {
  /** Groups the radios. Unique per control on the page. */
  name: string;
  options: readonly { value: T; label: ReactNode }[];
  value: T;
  onChange: (value: T) => void;
  label: string;
  className?: string;
}) {
  return (
    <fieldset className={cx('flex flex-wrap gap-1.5', className)}>
      <legend className="sr-only">{label}</legend>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <label
            key={String(option.value)}
            className={cx(
              'cursor-pointer rounded-full border px-3 py-1.5 text-body',
              'transition-colors duration-base ease-standard',
              'has-[:focus-visible]:outline has-[:focus-visible]:outline-2',
              'has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent',
              selected
                ? 'border-accent bg-accent/10 text-ink'
                : 'border-line bg-raised text-muted hover:text-ink',
            )}
          >
            <input
              type="radio"
              name={name}
              className="sr-only"
              checked={selected}
              onChange={() => onChange(option.value)}
            />
            {option.label}
          </label>
        );
      })}
    </fieldset>
  );
}
