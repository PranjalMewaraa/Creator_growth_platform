import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';
import { cx } from './cx';

const CONTROL =
  'h-12 w-full rounded-xl border border-line bg-raised px-4 text-sm text-ink outline-none transition placeholder:text-faint focus:border-accent/70 focus:ring-2 focus:ring-accent/15';

export function Field({
  label,
  hint,
  error,
  htmlFor,
  required = false,
  hideLabel = false,
  children,
}: {
  label: string;
  hint?: string;
  /** What is wrong, shown in place of the hint and next to the field it belongs to (WP43). */
  error?: string;
  htmlFor?: string;
  required?: boolean;
  /** Visually hidden but still read by screen readers, for placeholder led designs. */
  hideLabel?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={htmlFor}
        className={cx('text-label font-medium text-muted', hideLabel && 'sr-only')}
      >
        {label}
        {required ? (
          <span className="ml-1 text-bad" aria-hidden>
            *
          </span>
        ) : null}
      </label>
      {children}
      {/* The error replaces the hint rather than joining it: two messages about one field is
          one more than anybody reads. Announced, because it usually appears after a submit. */}
      {error ? (
        <p
          id={htmlFor ? `${htmlFor}-error` : undefined}
          role="alert"
          className="text-caption text-bad"
        >
          {error}
        </p>
      ) : hint ? (
        <p className="text-caption text-faint">{hint}</p>
      ) : null}
    </div>
  );
}

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Decorative icon inside the field, on the left. */
  icon?: ReactNode;
  /** Marks the field as wrong, in the border and to a screen reader. */
  invalid?: boolean;
}

export function Input({ className, icon, invalid, ...props }: InputProps) {
  const control = cx(CONTROL, invalid && 'border-bad/70 focus:border-bad focus:ring-bad/15');
  if (!icon) return <input {...props} aria-invalid={invalid} className={cx(control, className)} />;
  return (
    <div className="relative">
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-4 flex items-center text-faint"
      >
        {icon}
      </span>
      <input {...props} aria-invalid={invalid} className={cx(control, 'pl-11', className)} />
    </div>
  );
}

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cx(CONTROL, 'appearance-none', className)} />;
}
