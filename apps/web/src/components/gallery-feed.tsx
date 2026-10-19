'use client';

import type { GalleryOutput } from '@cgp/core';
import { useEffect, useState } from 'react';

const VISUAL: ReadonlySet<string> = new Set(['image', 'thumbnail']);

/**
 * The Studio's own gallery feed (WP64): every output across the workspace, newest first, in a
 * masonry grid — what the idle canvas showed before this was "Nothing yet" and a sentence.
 * Plain CSS columns rather than a layout library: the browser already does this well with
 * `break-inside-avoid`, and nothing here needs to measure anything in JS.
 */
export function GalleryFeed({
  workspaceId,
  onOpen,
}: {
  workspaceId: string;
  onOpen: (jobId: string) => void;
}) {
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
      <div className="columns-2 gap-3 sm:columns-3 lg:columns-4">
        {Array.from({ length: 8 }, (_, i) => (
          <div
            key={i}
            className="mb-3 aspect-[3/4] w-full animate-pulse break-inside-avoid rounded-xl bg-raised"
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
          Everything you make shows up here, newest first — a feed of this workspace's own work.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="columns-2 gap-3 sm:columns-3 lg:columns-4">
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => onOpen(item.jobId)}
            className="group tap-target mb-3 block w-full cursor-pointer break-inside-avoid overflow-hidden rounded-xl border border-line bg-raised text-left transition-colors duration-base ease-standard hover:border-accent/50"
          >
            {item.media && VISUAL.has(item.kind) ? (
              // A real generated picture: next/image needs a known host per image, and this
              // grid already knows the bytes are real (WP16 checked them before they existed).
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
              <div className="flex aspect-[4/5] w-full flex-col justify-between p-3">
                <p className="line-clamp-5 text-xs leading-5 text-muted">
                  {item.text || item.intentText || '—'}
                </p>
              </div>
            )}
            <p className="truncate px-2.5 py-2 text-caption text-faint group-hover:text-muted">
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
