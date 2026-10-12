import type { ReactNode } from 'react';
import { cx } from './cx';

/**
 * A state, said in one word (WP43). Every screen had its own version of this pill — the sync
 * centre, the calendar, the composer and the accounts screen each wrote their own border,
 * padding and colour, which is how the same status ends up looking like three statuses.
 *
 * Tone is the meaning, not the colour: `good` is a thing that worked, `warn` a thing that
 * needs watching, `bad` a thing that needs a person. Colour alone never carries the meaning,
 * so the word inside always says it too.
 */
const TONES = {
  neutral: 'border-line text-muted',
  good: 'border-good/50 text-good',
  warn: 'border-hot/50 text-hot',
  bad: 'border-bad/50 text-bad',
  accent: 'border-accent/50 text-accent',
} as const;

export type BadgeTone = keyof typeof TONES;

export function Badge({
  tone = 'neutral',
  dot,
  className,
  children,
}: {
  tone?: BadgeTone;
  /** A small mark before the word, for a platform colour or a live state. */
  dot?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cx(
        'inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-caption',
        TONES[tone],
        className,
      )}
    >
      {dot}
      {children}
    </span>
  );
}

/**
 * A choice you can take back (WP43). Pressing the chosen one again clears it, so a creator is
 * never stuck with a decision they made by accident — the look controls in the Studio taught
 * us that one.
 */
export function Chip({
  selected = false,
  onClick,
  title,
  className,
  children,
}: {
  selected?: boolean;
  onClick?: () => void;
  title?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      title={title}
      onClick={onClick}
      className={cx(
        'cursor-pointer rounded-full border px-3 py-1.5 text-label',
        'transition-colors duration-base ease-standard',
        selected
          ? 'border-accent bg-accent/10 text-ink'
          : 'border-line bg-raised text-muted hover:text-ink',
        className,
      )}
    >
      {children}
    </button>
  );
}
