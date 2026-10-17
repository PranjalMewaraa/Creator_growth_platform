'use client';

import { Skeleton, SkeletonText, cx } from '@cgp/ui';

/**
 * What a generation looks like while it is still one (WP56): a skeleton the shape of what is
 * coming, and a pill saying what stage it is at, instead of a blank pane or a sentence alone.
 * The skeleton's pulse is the one infinite animation the plan allows, and only for this.
 */
export function GenerationStatus({
  kind,
  label,
  sceneCount,
}: {
  /** Shapes the skeleton: a picture, a reel frame, or lines of text. */
  kind: string;
  label: string;
  /** Video draws this many frames before it draws nothing else, so the skeleton says so. */
  sceneCount?: number;
}) {
  const visual = kind === 'image' || kind === 'thumbnail_set';
  const video = kind === 'video';

  return (
    <div className="flex flex-col gap-3">
      <span
        className="inline-flex w-fit items-center gap-2 rounded-full border border-accent/40 bg-accent/10 px-3 py-1 text-caption font-medium text-accent"
        role="status"
      >
        <span aria-hidden className="size-1.5 animate-pulse rounded-full bg-accent" />
        {label}
      </span>

      {visual ? (
        <Skeleton className="aspect-[4/5] w-full" />
      ) : video ? (
        <div
          className={cx('grid gap-2', sceneCount && sceneCount > 1 ? 'grid-cols-3' : 'grid-cols-1')}
        >
          {Array.from({ length: sceneCount ?? 3 }, (_, i) => (
            <Skeleton key={i} className="aspect-[9/16] w-full" />
          ))}
        </div>
      ) : (
        <SkeletonText lines={5} className="rounded-xl border border-line bg-raised p-4" />
      )}
    </div>
  );
}
