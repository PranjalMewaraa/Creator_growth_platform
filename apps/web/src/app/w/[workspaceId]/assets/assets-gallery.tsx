'use client';

import type { GalleryOutput } from '@cgp/core';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

const VISUAL: ReadonlySet<string> = new Set(['image', 'thumbnail', 'thumbnail_set']);

/** Assets: the workspace's own library of past generations, newest first — distinct from
 *  Studio's canvas, which shows curated inspiration rather than your own history. */
export function AssetsGallery({ workspaceId }: { workspaceId: string }) {
  const router = useRouter();
  const [items, setItems] = useState<GalleryOutput[] | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let stopped = false;
    void fetch(`/api/w/${workspaceId}/studio/feed`)
      .then((r) => (r.ok ? (r.json() as Promise<{ feed: GalleryOutput[] }>) : null))
      .then((body) => {
        if (stopped || !body) return;
        setItems(body.feed);
        if (body.feed.length < 24) setDone(true);
      })
      .catch(() => {
        if (!stopped) setItems([]);
      });
    return () => {
      stopped = true;
    };
  }, [workspaceId]);

  async function loadMore() {
    if (!items || items.length === 0) return;
    setLoadingMore(true);
    const before = items[items.length - 1]!.createdAt;
    const r = await fetch(
      `/api/w/${workspaceId}/studio/feed?before=${encodeURIComponent(before)}`,
    ).catch(() => null);
    setLoadingMore(false);
    if (!r?.ok) return;
    const body = (await r.json()) as { feed: GalleryOutput[] };
    if (body.feed.length < 24) setDone(true);
    setItems((current) => [...(current ?? []), ...body.feed]);
  }

  if (items === null) {
    return (
      <div className="columns-3 gap-2 sm:columns-4 sm:gap-2.5 md:columns-6 lg:columns-7 xl:columns-8">
        {Array.from({ length: 16 }, (_, i) => (
          <div
            key={i}
            className="mb-2 aspect-[3/4] w-full animate-pulse break-inside-avoid rounded-xl bg-raised sm:mb-2.5"
          />
        ))}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 py-12 text-center">
        <p className="text-sm font-medium text-ink">Nothing generated yet</p>
        <p className="max-w-xs text-sm text-muted">
          Everything you make in Studio shows up here, newest first.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="columns-3 gap-2 sm:columns-4 sm:gap-2.5 md:columns-6 lg:columns-7 xl:columns-8">
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => router.push(`/w/${workspaceId}/studio?job=${item.jobId}`)}
            className="group tap-target mb-2 block w-full cursor-pointer break-inside-avoid overflow-hidden rounded-lg border border-line bg-raised text-left transition-colors duration-base ease-standard hover:border-accent/50 sm:mb-2.5"
          >
            {item.media && VISUAL.has(item.kind) ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={item.media.url} alt="" className="w-full" loading="lazy" />
            ) : item.media && item.kind === 'video' ? (
              <video
                src={item.media.url}
                muted
                playsInline
                preload="metadata"
                className="aspect-[9/16] w-full object-cover"
              />
            ) : (
              <div className="flex aspect-[4/5] w-full flex-col justify-between p-2">
                <p className="line-clamp-4 text-[10px] leading-4 text-muted">
                  {item.text || item.intentText || '—'}
                </p>
              </div>
            )}
            <p className="truncate px-2 py-1.5 text-[10px] text-faint group-hover:text-muted">
              {item.intentText || '—'}
            </p>
          </button>
        ))}
      </div>
      {!done ? (
        <button
          type="button"
          onClick={() => void loadMore()}
          disabled={loadingMore}
          className="tap-target self-center rounded-xl border border-line bg-raised px-4 py-2 text-sm text-muted transition-colors duration-base ease-standard hover:border-faint hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loadingMore ? 'Loading…' : 'Load more'}
        </button>
      ) : null}
    </div>
  );
}
