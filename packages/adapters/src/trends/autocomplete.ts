import type { Logger } from '@cgp/config';
import type { RawTrendSignal } from '@cgp/contracts';

/**
 * Google's own public autocomplete endpoint (WP61): what people are actually typing after a
 * niche's name, right now. No key, no quota that matters at this volume — the closest this
 * stack gets to the draft's pytrends source without a Python runtime (see the ADR note in
 * packages/core/src/trends.ts for why pytrends itself was dropped).
 */
export async function fetchAutocompleteSignals(
  niche: string,
  log?: Logger,
): Promise<RawTrendSignal[]> {
  const url = new URL('https://suggestqueries.google.com/complete/search');
  url.searchParams.set('client', 'firefox');
  url.searchParams.set('q', niche);

  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(8_000) });
    if (!response.ok) {
      log?.warn({ status: response.status, niche }, 'autocomplete fetch failed');
      return [];
    }
    // [query, [suggestion, ...]] — an old OpenSearch shape, not JSON with named fields.
    const body = (await response.json()) as [string, string[]];
    const suggestions = Array.isArray(body) ? body[1] : [];
    return (suggestions ?? [])
      .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
      .map((title) => ({ source: 'autocomplete' as const, title }));
  } catch (err) {
    log?.warn({ err, niche }, 'autocomplete fetch errored');
    return [];
  }
}
