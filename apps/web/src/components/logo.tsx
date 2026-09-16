import { cx } from '@cgp/ui';

/** Placeholder mark and wordmark until there is a brand. */
export function Logo({ className, compact = false }: { className?: string; compact?: boolean }) {
  return (
    <span className={cx('flex items-center gap-2.5', className)}>
      <span
        aria-hidden
        className="grid size-8 place-items-center rounded-lg bg-gradient-to-br from-accent to-hot text-accent-ink"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 2l2.4 6.9L21 11l-6.6 2.1L12 20l-2.4-6.9L3 11l6.6-2.1z" />
        </svg>
      </span>
      {compact ? null : (
        <span className="text-base font-semibold tracking-tight text-ink">Creator Growth</span>
      )}
    </span>
  );
}
