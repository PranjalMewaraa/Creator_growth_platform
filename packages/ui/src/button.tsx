import type { ButtonHTMLAttributes } from 'react';
import { cx } from './cx';

const VARIANTS = {
  /** The one action on a screen. Yellow with a soft glow. */
  primary:
    'bg-accent text-accent-ink shadow-[0_10px_30px_-12px_var(--color-accent)] hover:brightness-105 disabled:opacity-60 disabled:shadow-none',
  secondary: 'border border-line bg-raised text-ink hover:border-faint disabled:text-faint',
  quiet: 'text-muted hover:bg-raised hover:text-ink disabled:text-faint',
} as const;

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof VARIANTS;
}

export function Button({ variant = 'primary', className, ...props }: ButtonProps) {
  return (
    <button
      {...props}
      className={cx(
        'inline-flex h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-medium transition disabled:cursor-not-allowed',
        VARIANTS[variant],
        className,
      )}
    />
  );
}
