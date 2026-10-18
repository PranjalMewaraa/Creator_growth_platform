import type { Logger } from '@cgp/config';
import type { RawTrendSignal } from '@cgp/contracts';

/** Niches this ingests map to the subreddit most likely to be talking about them, since Reddit
 *  has no topic search free of an API key. Unmapped niches simply get no Reddit signal. */
const SUBREDDIT_BY_NICHE: Record<string, string> = {
  tech: 'technology',
  ai: 'artificial',
  finance: 'personalfinance',
  fitness: 'fitness',
  'creator economy': 'NewTubers',
};

/**
 * A subreddit's top posts of the day, read from its public `.json` feed (WP61) — no key, no
 * app registration, just a real User-Agent (Reddit rate limits the default one hard).
 */
export async function fetchRedditSignals(niche: string, log?: Logger): Promise<RawTrendSignal[]> {
  const subreddit = SUBREDDIT_BY_NICHE[niche.toLowerCase()];
  if (!subreddit) return [];
  const url = `https://www.reddit.com/r/${subreddit}/top.json?t=day&limit=10`;

  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'creatorpltfrm-trend-radar/1.0' },
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) {
      log?.warn({ status: response.status, niche, subreddit }, 'reddit trend fetch failed');
      return [];
    }
    const body = (await response.json()) as {
      data?: { children?: Array<{ data?: { title?: string; score?: number; permalink?: string } }> };
    };
    const posts = body.data?.children ?? [];
    return posts
      .filter((p): p is { data: { title: string; score?: number; permalink?: string } } =>
        Boolean(p.data?.title),
      )
      .map((p) => ({
        source: 'reddit' as const,
        title: p.data.title,
        metric: typeof p.data.score === 'number' ? `${p.data.score} upvotes` : undefined,
        url: p.data.permalink ? `https://www.reddit.com${p.data.permalink}` : undefined,
      }));
  } catch (err) {
    log?.warn({ err, niche, subreddit }, 'reddit trend fetch errored');
    return [];
  }
}
