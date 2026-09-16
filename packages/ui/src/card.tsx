import type { ReactNode } from 'react';
import { cx } from './cx';

/** Cards resolve independently, so a screen never waits behind one spinner (plan section 13). */
export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <section className={cx('rounded-2xl border border-line bg-surface', className)}>
      {children}
    </section>
  );
}

export function CardHeader({
  title,
  note,
  action,
}: {
  title: string;
  note?: string;
  action?: ReactNode;
}) {
  return (
    <header className="flex items-start justify-between gap-3 px-5 pt-5">
      <div>
        <h2 className="text-sm font-medium text-ink">{title}</h2>
        {note ? <p className="mt-0.5 text-xs text-faint">{note}</p> : null}
      </div>
      {action}
    </header>
  );
}

export function CardBody({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cx('px-5 py-5', className)}>{children}</div>;
}
