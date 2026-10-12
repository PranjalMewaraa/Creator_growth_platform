'use client';

import type { ReactNode } from 'react';
import { useRef } from 'react';
import { cx } from './cx';

export interface TabOption<T extends string> {
  value: T;
  label: ReactNode;
}

/**
 * Tabs with the keyboard behaviour the pattern actually requires (WP43): arrows move between
 * them, Home and End jump to the ends, and only the selected tab is in the tab order, so Tab
 * takes you out of the strip rather than through every one of them.
 *
 * The composer and the Studio both grew their own tab strips without any of that.
 */
export function Tabs<T extends string>({
  options,
  value,
  onChange,
  label,
  className,
}: {
  options: readonly TabOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** What this set of tabs is for, since the strip itself has no visible name. */
  label: string;
  className?: string;
}) {
  const strip = useRef<HTMLDivElement>(null);

  function move(by: number, from: number) {
    const next = (from + by + options.length) % options.length;
    const option = options[next];
    if (!option) return;
    onChange(option.value);
    // Focus follows selection, which is what makes arrow keys feel like tabs rather than
    // like a listbox someone forgot to wire up.
    strip.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
  }

  return (
    <div
      ref={strip}
      role="tablist"
      aria-label={label}
      className={cx('flex rounded-xl border border-line bg-raised p-0.5', className)}
    >
      {options.map((option, index) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowRight') move(1, index);
              else if (event.key === 'ArrowLeft') move(-1, index);
              else if (event.key === 'Home') move(-index, index);
              else if (event.key === 'End') move(options.length - 1 - index, index);
              else return;
              event.preventDefault();
            }}
            className={cx(
              'flex-1 cursor-pointer rounded-lg px-4 py-1.5 text-body',
              'transition-colors duration-base ease-standard',
              selected ? 'bg-ink font-medium text-canvas' : 'text-muted hover:text-ink',
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
