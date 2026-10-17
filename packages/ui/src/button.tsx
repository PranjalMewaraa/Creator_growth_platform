import type { ButtonHTMLAttributes } from 'react';
import { cx } from './cx';

const VARIANTS = {
  /** The one action on a screen. Accent-coloured with a soft glow. */
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
        // h-11 is 44px, the smallest a finger reliably hits. The transition is by colour and
        // never by scale: a control that grows on hover moves the things next to it.
        'inline-flex h-11 cursor-pointer items-center justify-center gap-2 rounded-xl px-4',
        'text-body font-medium transition-[background-color,border-color,color,box-shadow,filter]',
        'duration-base ease-standard disabled:cursor-not-allowed',
        VARIANTS[variant],
        className,
      )}
    />
  );
}
