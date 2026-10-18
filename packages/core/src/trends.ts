import type { Logger } from '@cgp/config';
import type {
  ModerationAdapter,
  RawTrendSignal,
  TextAdapter,
  TrendSource,
  TrendView,
} from '@cgp/contracts';
import {
  bookmarkedTrendIds,
  findTrend,
  listTrendNiches,
  listTrends,
  removeTrendBookmark,
  saveTrendBookmark,
  upsertTrend,
  type TrendRow,
  type Database,
} from '@cgp/db';
import { synthesizeTrends } from '@cgp/orchestration';

// Trend Radar (WP61). The draft this shipped from specified Google Trends via pytrends as a
// fourth source; dropped here rather than faked, because pytrends is a Python library and
// this codebase has no Python runtime anywhere in it (apps/web and apps/worker are both
// Node/TypeScript). Autocomplete already covers the same "what are people typing" signal
// pytrends would have added, without a second runtime to deploy and keep alive for one source.

export interface TrendIngestionDeps {
  db: Database;
  youtubeApiKey: string | undefined;
  /** Clusters and writes up the synthesis; Gemini Flash-Lite in production (see trends.ts in
   *  packages/orchestration for why, not Groq). */
  synthesisProvider: TextAdapter | undefined;
  moderation: ModerationAdapter;
  log: Logger;
  fetchYouTube: (apiKey: string | undefined, niche: string, log?: Logger) => Promise<RawTrendSignal[]>;
  fetchAutocomplete: (niche: string, log?: Logger) => Promise<RawTrendSignal[]>;
  fetchReddit: (niche: string, log?: Logger) => Promise<RawTrendSignal[]>;
}

export interface IngestionResult {
  niche: string;
  signalsFetched: number;
  trendsWritten: number;
  trendsFlagged: number;
}

/** The one source a niche's signals all came from, or 'blended' when more than one answered. */
function dominantSource(signals: RawTrendSignal[]): TrendSource {
  const sources = new Set(signals.map((s) => s.source));
  return sources.size === 1 ? [...sources][0]! : 'blended';
}

/**
 * One niche, one tick: fetch every source, synthesise, check, upsert. Best effort throughout —
 * a source that fails or a synthesis that comes back empty leaves whatever was already on the
 * radar from the last tick untouched, rather than clearing it.
 */
export async function ingestTrendsForNiche(
  deps: TrendIngestionDeps,
  niche: string,
  region = 'global',
): Promise<IngestionResult> {
  const [youtube, autocomplete, reddit] = await Promise.all([
    deps.fetchYouTube(deps.youtubeApiKey, niche, deps.log),
    deps.fetchAutocomplete(niche, deps.log),
    deps.fetchReddit(niche, deps.log),
  ]);
  const signals = [...youtube, ...autocomplete, ...reddit];
  if (signals.length === 0) {
    return { niche, signalsFetched: 0, trendsWritten: 0, trendsFlagged: 0 };
  }

  const synthesized = await synthesizeTrends({
    niche,
    region,
    signals,
    provider: deps.synthesisProvider,
    log: deps.log,
  });

  let written = 0;
  let flagged = 0;
  for (const trend of synthesized) {
    // Ingested and AI-written text is exactly what invariant 10 means by unchecked content
    // (packages/core/src/moderation.ts): it never reaches a creator without a check first.
    // Not recorded to moderation_events, which is workspace scoped and a trend is not any one
    // workspace's data — logged instead.
    try {
      const verdict = await deps.moderation.checkText(
        `${trend.topicTitle}\n${trend.summary}\n${trend.creativeAngles.contrarian}`,
      );
      if (!verdict.allowed) {
        flagged += 1;
        deps.log.info(
          { niche, topic: trend.topicTitle, category: verdict.flagged[0]?.category },
          'trend blocked, not written',
        );
        continue;
      }
    } catch (err) {
      deps.log.warn({ err, niche, topic: trend.topicTitle }, 'moderation unavailable, trend skipped');
      continue;
    }

    await upsertTrend(deps.db, {
      niche,
      region,
      topicTitle: trend.topicTitle,
      searchVolumeIndicator: trend.searchVolumeIndicator,
      velocityScore: trend.velocityScore,
      lifecycleStage: trend.lifecycleStage,
      sourcePlatform: dominantSource(signals),
      summary: trend.summary,
      creativeAngles: trend.creativeAngles,
      suggestedHooks: trend.suggestedHooks,
      recommendedTags: trend.recommendedTags,
      estimatedLifespan: trend.estimatedLifespan,
    });
    written += 1;
  }

  deps.log.info(
    { niche, signals: signals.length, written, flagged },
    'trend ingestion tick done for niche',
  );
  return { niche, signalsFetched: signals.length, trendsWritten: written, trendsFlagged: flagged };
}

export async function ingestTrends(
  deps: TrendIngestionDeps,
  niches: string[],
  region = 'global',
): Promise<IngestionResult[]> {
  const results: IngestionResult[] = [];
  // One niche at a time, not in parallel: each one makes real calls against the same free
  // tiers (YouTube's 10k units/day chief among them), and a burst across niches is how a
  // quota gets spent by Tuesday.
  for (const niche of niches) {
    results.push(await ingestTrendsForNiche(deps, niche, region));
  }
  return results;
}

function toTrendView(row: TrendRow): TrendView {
  return {
    id: row.id,
    niche: row.niche,
    region: row.region,
    topicTitle: row.topicTitle,
    searchVolumeIndicator: row.searchVolumeIndicator,
    velocityScore: row.velocityScore,
    lifecycleStage: row.lifecycleStage,
    sourcePlatform: row.sourcePlatform,
    summary: row.summary,
    creativeAngles: row.creativeAngles as TrendView['creativeAngles'],
    suggestedHooks: row.suggestedHooks,
    recommendedTags: row.recommendedTags as TrendView['recommendedTags'],
    estimatedLifespan: row.estimatedLifespan,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export interface TrendListView {
  trends: TrendView[];
  niches: string[];
}

/** The radar's own read: every niche ever ingested (for the filter dropdown) plus the list
 *  filtered to what was asked for, each trend marked with whether this member saved it. */
export async function listTrendsView(
  db: Database,
  workspaceId: string,
  userId: string,
  filter: { niche?: string; region?: string } = {},
): Promise<TrendListView & { bookmarked: Record<string, boolean> }> {
  const [rows, niches] = await Promise.all([listTrends(db, filter), listTrendNiches(db)]);
  const bookmarks = await bookmarkedTrendIds(
    db,
    workspaceId,
    userId,
    rows.map((r) => r.id),
  );
  return {
    trends: rows.map(toTrendView),
    niches,
    bookmarked: Object.fromEntries(rows.map((r) => [r.id, bookmarks.has(r.id)])),
  };
}

export async function trendView(db: Database, id: string): Promise<TrendView | undefined> {
  const row = await findTrend(db, id);
  return row ? toTrendView(row) : undefined;
}

const STOPWORDS = new Set([
  'this', 'that', 'these', 'those', 'with', 'from', 'your', 'youre', 'about', 'into', 'their',
  'there', 'where', 'when', 'what', 'which', 'while', 'have', 'has', 'had', 'were', 'was', 'are',
  'is', 'be', 'been', 'being', 'will', 'would', 'could', 'should', 'just', 'like', 'than', 'then',
  'also', 'more', 'most', 'some', 'such', 'only', 'very', 'over', 'under', 'after', 'before',
  'here', 'they', 'them', 'and', 'the', 'for', 'you', 'our', 'out', 'get', 'got', 'how', 'why',
  'who', 'one', 'two', 'all', 'not', 'but', 'can', 'its', 'it’s',
]);

/** Lowercased, significant words only — no hashmarks, no punctuation, nothing short enough to
 *  match by accident. */
function significantWords(text: string): Set<string> {
  const words = text
    .toLowerCase()
    .replace(/[#@]/g, ' ')
    .match(/[a-z0-9']+/g);
  return new Set((words ?? []).filter((w) => w.length >= 4 && !STOPWORDS.has(w)));
}

function trendVocabulary(trend: TrendRow): Set<string> {
  return significantWords(
    [trend.topicTitle, trend.niche, trend.summary, ...trend.suggestedHooks].join(' '),
  );
}

export interface TrendMatch {
  trendId: string;
  topicTitle: string;
  niche: string;
  velocityScore: number;
  /** 0 to 1: the share of the trend's own vocabulary this caption already uses. */
  relevance: number;
}

export interface CaptionTrendFit {
  /** 0 to 100. Not a virality prediction — how much of the single closest trend's own
   *  language this caption already echoes, weighted by how fast that trend is rising. A high
   *  score means "sounds like you're actually talking about this", nothing more. */
  score: number;
  matches: TrendMatch[];
  suggestedHashtags: string[];
  suggestedKeywords: string[];
}

/**
 * Scores a caption against everything Trend Radar has ingested (WP62), not against general
 * writing heuristics — the user asked for this specifically rather than an invented quality
 * score this app has no grounds to claim. Pure lexical overlap, no LLM call: this runs on
 * every pause while typing, and a model call on every keystroke pause is neither free nor fast.
 */
export async function matchCaptionToTrends(db: Database, text: string): Promise<CaptionTrendFit> {
  const captionWords = significantWords(text);
  if (captionWords.size === 0) {
    return { score: 0, matches: [], suggestedHashtags: [], suggestedKeywords: [] };
  }

  const rows = await listTrends(db, { limit: 200 });
  const scored = rows
    .map((row) => {
      const vocabulary = trendVocabulary(row);
      if (vocabulary.size === 0) return undefined;
      const shared = [...vocabulary].filter((w) => captionWords.has(w));
      const relevance = shared.length / vocabulary.size;
      if (relevance === 0) return undefined;
      return {
        row,
        relevance,
        weighted: relevance * (row.velocityScore / 100),
      };
    })
    .filter((s): s is NonNullable<typeof s> => s !== undefined)
    .sort((a, b) => b.weighted - a.weighted);

  const top = scored.slice(0, 3);
  const score = top.length > 0 ? Math.round(Math.min(1, top[0]!.weighted) * 100) : 0;

  const lowerText = text.toLowerCase();
  const alreadyPresent = (candidate: string) => lowerText.includes(candidate.toLowerCase());

  const suggestedHashtags = [
    ...new Set(
      top.flatMap(({ row }) =>
        Object.values(row.recommendedTags as Record<string, string[] | undefined>)
          .flat()
          .filter((t): t is string => typeof t === 'string'),
      ),
    ),
  ]
    .map((t) => `#${t.replace(/^#/, '')}`)
    .filter((t) => !alreadyPresent(t))
    .slice(0, 8);

  const suggestedKeywords = [
    ...new Set(
      top.flatMap(({ row }) => [row.topicTitle, ...row.suggestedHooks.slice(0, 1)]),
    ),
  ]
    .filter((k) => !alreadyPresent(k))
    .slice(0, 5);

  return {
    score,
    matches: top.map(({ row, relevance }) => ({
      trendId: row.id,
      topicTitle: row.topicTitle,
      niche: row.niche,
      velocityScore: row.velocityScore,
      relevance: Math.round(relevance * 100) / 100,
    })),
    suggestedHashtags,
    suggestedKeywords,
  };
}

export type SaveTrendResult =
  | { ok: true }
  | { ok: false; reason: 'trend_not_found' };

export async function toggleTrendBookmark(
  db: Database,
  workspaceId: string,
  userId: string,
  trendId: string,
  save: boolean,
): Promise<SaveTrendResult> {
  if (save) {
    const row = await findTrend(db, trendId);
    if (!row) return { ok: false, reason: 'trend_not_found' };
    await saveTrendBookmark(db, workspaceId, userId, trendId);
  } else {
    await removeTrendBookmark(db, workspaceId, userId, trendId);
  }
  return { ok: true };
}
