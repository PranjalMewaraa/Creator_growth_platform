import { Skeleton, SkeletonText } from '@cgp/ui';

/**
 * Shown while a screen's server work runs (WP51). Every screen here reads Postgres before it
 * renders, and over a slow link that was a blank main area under a working shell. The shape
 * is the one most screens share: a title, a line under it, then cards.
 */
export default function WorkspaceLoading() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true" aria-live="polite">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-4 w-72 max-w-full" />
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
        <div className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-5">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-10 w-32" />
          <SkeletonText lines={2} />
        </div>
        <div className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-5">
          <Skeleton className="h-4 w-32" />
          <SkeletonText lines={3} />
        </div>
      </div>
      <span className="sr-only">Loading</span>
    </div>
  );
}
