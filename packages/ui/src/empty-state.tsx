import type { ReactNode } from 'react';

/**
 * The frame renders, then fills. An empty state says what belongs here and what to do next,
 * never just "no data".
 */
export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-start gap-1.5 px-5 py-8">
      <p className="text-sm font-medium text-ink">{title}</p>
      <p className="max-w-prose text-sm text-muted">{description}</p>
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}
