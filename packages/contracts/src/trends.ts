// Trend Radar (WP61): what a trend row is, shared by the ingestion worker that writes one,
// the orchestration layer that synthesises it, and the UI that reads it back, so the three
// cannot drift apart on what a "trend" contains.

/** Where a signal came from. `blended` is a trend assembled from more than one source. */
export const TREND_SOURCES = ['youtube', 'autocomplete', 'reddit', 'blended'] as const;
export type TrendSource = (typeof TREND_SOURCES)[number];

/** How far along a trend's life a topic is, not how popular it is right now. */
export const TREND_LIFECYCLE_STAGES = ['rising', 'peak', 'evergreen', 'decaying'] as const;
export type TrendLifecycleStage = (typeof TREND_LIFECYCLE_STAGES)[number];

/** The three angles every trend is broken into, so a creator always has a way in beyond
 *  "make a video about this". */
export interface CreativeAngles {
  contrarian: string;
  howTo: string;
  predictive: string;
}

/** Platform-tailored tags, one list per platform that actually wants hashtags. */
export interface RecommendedTags {
  tiktok?: string[];
  instagram?: string[];
  youtube?: string[];
  linkedin?: string[];
}

/** A trend as the UI and the generators read it. Matches the `trending_topics` row 1:1. */
export interface TrendView {
  id: string;
  niche: string;
  region: string;
  topicTitle: string;
  searchVolumeIndicator: string | null;
  /** 1 to 100. Not a real percentile — a relative read across this batch's signals. */
  velocityScore: number;
  lifecycleStage: TrendLifecycleStage;
  sourcePlatform: TrendSource;
  summary: string;
  creativeAngles: CreativeAngles;
  suggestedHooks: string[];
  recommendedTags: RecommendedTags;
  estimatedLifespan: string | null;
  createdAt: string;
  updatedAt: string;
}

/** One ingested signal, before synthesis: the common shape every source adapter normalises
 *  its raw response into, whatever the source actually returned. */
export interface RawTrendSignal {
  source: Exclude<TrendSource, 'blended'>;
  title: string;
  /** A metric in that source's own terms (view count, comment count, suggestion rank...). Not
   *  comparable across sources; the synthesis pass reads it as texture, not as a score input. */
  metric?: string;
  url?: string;
}
