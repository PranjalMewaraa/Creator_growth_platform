import Link from 'next/link';
import type { ReactNode } from 'react';

/**
 * The page for when a page cannot be shown (WP51). Until now a thrown error reached Next's
 * own white screen and a wrong URL reached its own 404, neither of which looked like the
 * product or said what to do. This says one thing, offers one way back, and keeps the
 * detail where a developer can see it rather than where a creator has to read it.
 */
export function Trouble({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-md flex-col items-start justify-center gap-4 px-4 py-16">
      <p className="text-caption font-medium uppercase tracking-wide text-faint">
        Creator Growth Platform
      </p>
      <h1 className="text-title font-display font-semibold text-ink">{title}</h1>
      <div className="text-body leading-6 text-muted">{children}</div>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        {action}
        <Link
          href="/"
          className="inline-flex h-11 items-center rounded-xl border border-line px-5 text-body text-ink transition duration-base ease-standard hover:border-faint"
        >
          Go home
        </Link>
      </div>
    </div>
  );
}
