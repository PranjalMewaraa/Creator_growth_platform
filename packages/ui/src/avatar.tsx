import { cx } from './cx';

/**
 * Who a thing belongs to (WP43). The calendar, the sync centre and the composer each drew
 * their own initial-in-a-ring; this is that, once. The ring carries the platform's own colour,
 * which is the only place in the product where a brand's palette is allowed to appear.
 */
const SIZES = {
  sm: 'size-8 text-caption',
  md: 'size-10 text-label',
  lg: 'size-12 text-body',
} as const;

export function Avatar({
  name,
  ring,
  size = 'md',
  className,
}: {
  name: string;
  /** The ring's background, usually a platform's colour. Plain line when absent. */
  ring?: string;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  // An `@` or stray spaces are how these names arrive; the letter underneath is what matters.
  const initial = name.replace(/^@/, '').trim().charAt(0).toUpperCase() || '?';
  return (
    <span
      // Decorative: the name is always written beside it, so a reader hears it once, not twice.
      aria-hidden
      className={cx('shrink-0 rounded-full p-[2px]', ring ?? 'bg-line', SIZES[size], className)}
    >
      <span className="flex h-full w-full items-center justify-center rounded-full bg-raised font-semibold text-ink">
        {initial}
      </span>
    </span>
  );
}
