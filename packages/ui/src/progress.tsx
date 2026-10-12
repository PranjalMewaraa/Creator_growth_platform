import { cx } from './cx';

/**
 * How far along something is (WP43). Determinate when the work has countable parts — three
 * frames, three scenes — and indeterminate only when it genuinely cannot be counted, because
 * a bar that fills to a number nobody knows is a lie told smoothly.
 */
export function Progress({
  value,
  max = 100,
  label,
  className,
}: {
  /** Omit for work whose length is unknown. */
  value?: number;
  max?: number;
  /** What is being waited for, read out instead of the number. */
  label: string;
  className?: string;
}) {
  const determinate = typeof value === 'number';
  const percent = determinate ? Math.max(0, Math.min(100, (value / max) * 100)) : undefined;
  return (
    <span
      role="progressbar"
      aria-label={label}
      {...(determinate ? { 'aria-valuenow': value, 'aria-valuemin': 0, 'aria-valuemax': max } : {})}
      className={cx('block h-1 w-full overflow-hidden rounded-full bg-raised', className)}
    >
      <span
        className={cx(
          'block h-full rounded-full bg-accent',
          determinate
            ? 'transition-[width] duration-slow ease-standard'
            : 'w-1/3 animate-[indeterminate_1.4s_ease-in-out_infinite]',
        )}
        style={determinate ? { width: `${percent}%` } : undefined}
      />
    </span>
  );
}
