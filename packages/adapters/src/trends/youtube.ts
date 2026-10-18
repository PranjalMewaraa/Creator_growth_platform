import type { Logger } from '@cgp/config';
import type { RawTrendSignal } from '@cgp/contracts';

/**
 * YouTube Data API v3's search.list, read for what a niche's query is turning up right now
 * (WP61). Free tier: 10k units/day, and a search call costs 100 — about 100 calls a day across
 * every niche this ingests, which is why the worker ticks every few hours rather than every
 * few minutes.
 *
 * Never throws: a quota breach or a missing key means this source sits out the tick, same as
 * every other best-effort fetch in the ingestion pass.
 */
export async function fetchYouTubeSignals(
  apiKey: string | undefined,
  niche: string,
  log?: Logger,
): Promise<RawTrendSignal[]> {
  if (!apiKey) return [];
  const url = new URL('https://www.googleapis.com/youtube/v3/search');
  url.searchParams.set('part', 'snippet');
  url.searchParams.set('q', niche);
  url.searchParams.set('type', 'video');
  url.searchParams.set('order', 'viewCount');
  url.searchParams.set('publishedAfter', new Date(Date.now() - 7 * 86_400_000).toISOString());
  url.searchParams.set('maxResults', '10');
  url.searchParams.set('key', apiKey);

  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) {
      log?.warn({ status: response.status, niche }, 'youtube trend fetch failed');
      return [];
    }
    const body = (await response.json()) as {
      items?: Array<{ id?: { videoId?: string }; snippet?: { title?: string } }>;
    };
    return (body.items ?? [])
      .filter((item): item is { id: { videoId: string }; snippet: { title: string } } =>
        Boolean(item.id?.videoId && item.snippet?.title),
      )
      .map((item) => ({
        source: 'youtube' as const,
        title: item.snippet.title,
        url: `https://www.youtube.com/watch?v=${item.id.videoId}`,
      }));
  } catch (err) {
    log?.warn({ err, niche }, 'youtube trend fetch errored');
    return [];
  }
}
