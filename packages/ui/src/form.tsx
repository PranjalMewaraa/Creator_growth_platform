import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';
import { cx } from './cx';

const CONTROL =
  'h-12 w-full rounded-xl border border-line bg-raised px-4 text-sm text-ink outline-none transition placeholder:text-faint focus:border-accent/70 focus:ring-2 focus:ring-accent/15';

export function Field({
  label,
  hint,
  htmlFor,
  hideLabel = false,
  children,
}: {
  label: string;
  hint?: string;
  htmlFor?: string;
  /** Visually hidden but still read by screen readers, for placeholder led designs. */
  hideLabel?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={htmlFor}
        className={cx('text-sm font-medium text-muted', hideLabel && 'sr-only')}
      >
        {label}
      </label>
      {children}
      {hint ? <p className="text-xs text-faint">{hint}</p> : null}
    </div>
  );
}

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Decorative icon inside the field, on the left. */
  icon?: ReactNode;
}

export function Input({ className, icon, ...props }: InputProps) {
  if (!icon) return <input {...props} className={cx(CONTROL, className)} />;
  return (
    <div className="relative">
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-4 flex items-center text-faint"
      >
        {icon}
      </span>
      <input {...props} className={cx(CONTROL, 'pl-11', className)} />
    </div>
  );
}

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cx(CONTROL, 'appearance-none', className)} />;
}
