'use client';

import { cx } from './cx';

/** A setting that is on or off, and takes effect at once (WP43). Not a checkbox in a form. */
export function Toggle({
  on,
  onChange,
  label,
  className,
}: {
  on: boolean;
  onChange: (on: boolean) => void;
  /** Read out instead of the switch, which has nothing visible to read. */
  label: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={cx(
        'relative h-7 w-12 shrink-0 cursor-pointer rounded-full border',
        'transition-colors duration-base ease-standard',
        on ? 'border-accent bg-accent' : 'border-line bg-raised',
        className,
      )}
    >
      <span
        className={cx(
          // Moved by translate, not by `left`: a transform does not make the browser lay the
          // page out again on every frame of the slide.
          'absolute left-1 top-1/2 size-5 -translate-y-1/2 rounded-full',
          'transition-transform duration-base ease-standard',
          on ? 'translate-x-5 bg-accent-ink' : 'bg-faint',
        )}
      />
    </button>
  );
}
