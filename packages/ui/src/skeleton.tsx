import { cx } from './cx';

/**
 * The shape of something that has not arrived (WP43). A skeleton reserves the space the real
 * thing will take, so the page does not jump when it lands — which is the actual reason to use
 * one, rather than decoration.
 *
 * The pulse is the one infinite animation this product allows, and only here: an indicator
 * that something is loading is the exception the motion rules make.
 */
export function Skeleton({ className }: { className?: string }) {
  return <span aria-hidden className={cx('block animate-pulse rounded-xl bg-raised', className)} />;
}

/**
 * Several lines of text that are still coming. The last line is short, because a paragraph's
 * last line usually is, and the small untruth of equal lines is what makes a skeleton read as
 * a loading graphic rather than as text.
 */
export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <span className={cx('flex flex-col gap-2', className)} aria-hidden>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className={cx('h-3', i === lines - 1 ? 'w-2/3' : 'w-full')} />
      ))}
    </span>
  );
}
