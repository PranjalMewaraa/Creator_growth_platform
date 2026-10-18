import type { Logger } from '@cgp/config';
import type {
  CreativeAngles,
  RawTrendSignal,
  RecommendedTags,
  TextAdapter,
  TrendLifecycleStage,
} from '@cgp/contracts';
import { TREND_LIFECYCLE_STAGES } from '@cgp/contracts';

/**
 * Trend synthesis (WP61): raw signals in — titles from YouTube, Autocomplete, Reddit, blended
 * without being told apart — distinct, structured trends out. This is the one LLM call in the
 * ingestion pass; everything else (fetching, storing) is plain HTTP and SQL. Not a Python
 * pytrends pipeline, which this Node/TypeScript codebase has no way to run, and not Groq,
 * which would be a new provider and a new key for no reason: Gemini Flash-Lite is already
 * wired for every other structured-output call this app makes (scenes.ts, rewrite.ts), via
 * Vertex application-default credentials rather than a key of its own, so synthesis costs
 * nothing new to set up.
 *
 * Runs on a background tick, not a request a creator is waiting on, so its budget is generous
 * next to the compile rewrite's 1500ms (packages/orchestration/src/rewrite.ts) — more like the
 * scene planner's (packages/orchestration/src/scenes.ts).
 */
export const TREND_SYNTHESIS_BUDGET_MS = 25_000;

export interface SynthesizedTrend {
  topicTitle: string;
  searchVolumeIndicator: string;
  velocityScore: number;
  lifecycleStage: TrendLifecycleStage;
  summary: string;
  creativeAngles: CreativeAngles;
  suggestedHooks: string[];
  recommendedTags: RecommendedTags;
  estimatedLifespan: string;
}

export interface TrendSynthesisRequest {
  niche: string;
  region: string;
  signals: RawTrendSignal[];
  provider: TextAdapter | undefined;
  budgetMs?: number;
  log?: Logger;
}

const SYSTEM = [
  'You read raw signals from YouTube, search autocomplete and Reddit for one content niche, and',
  'group them into the small number of genuinely distinct topics actually trending in it right',
  'now — never one entry per signal, and never a topic that is really the whole niche itself.',
  'For each topic, write:',
  'topicTitle: a short, specific name for the topic, not the niche name.',
  'searchVolumeIndicator: a short human phrase, such as "High (Breakout)" or "Moderate".',
  'velocityScore: 1 to 100, how fast this is rising relative to the other topics you found here.',
  'lifecycleStage: one of rising, peak, evergreen, decaying.',
  'summary: two sentences on why this is gaining traction right now.',
  'creativeAngles: three distinct openings a creator could take — contrarian (push back on the',
  'common take), howTo (a practical walkthrough), predictive (where this goes next) — each one',
  'to two sentences, in a creator\'s own voice, never generic.',
  'suggestedHooks: three to five punchy opening lines, under 15 words each, ready to say on camera.',
  'recommendedTags: short hashtag lists, platform names you have grounds for from the signals',
  '(tiktok, instagram, youtube, linkedin) as keys — omit a platform rather than guess at it.',
  'estimatedLifespan: a short phrase, such as "24-48 hours" or "1-2 weeks".',
  'Ground every field in the signals given; invent no statistic, quote or claim that is not in them.',
  'Reply with JSON: {"trends": [...]}, three to six entries, ranked by velocityScore descending.',
].join(' ');

function schema() {
  const angles = {
    type: 'object',
    properties: {
      contrarian: { type: 'string' },
      howTo: { type: 'string' },
      predictive: { type: 'string' },
    },
    required: ['contrarian', 'howTo', 'predictive'],
  };
  const tags = {
    type: 'object',
    properties: {
      tiktok: { type: 'array', items: { type: 'string' } },
      instagram: { type: 'array', items: { type: 'string' } },
      youtube: { type: 'array', items: { type: 'string' } },
      linkedin: { type: 'array', items: { type: 'string' } },
    },
  };
  return {
    type: 'object',
    properties: {
      trends: {
        type: 'array',
        minItems: 1,
        maxItems: 6,
        items: {
          type: 'object',
          properties: {
            topicTitle: { type: 'string' },
            searchVolumeIndicator: { type: 'string' },
            velocityScore: { type: 'integer' },
            lifecycleStage: { type: 'string', enum: [...TREND_LIFECYCLE_STAGES] },
            summary: { type: 'string' },
            creativeAngles: angles,
            suggestedHooks: { type: 'array', items: { type: 'string' } },
            recommendedTags: tags,
            estimatedLifespan: { type: 'string' },
          },
          required: [
            'topicTitle',
            'searchVolumeIndicator',
            'velocityScore',
            'lifecycleStage',
            'summary',
            'creativeAngles',
            'suggestedHooks',
            'recommendedTags',
            'estimatedLifespan',
          ],
        },
      },
    },
    required: ['trends'],
  };
}

function isLifecycleStage(value: unknown): value is TrendLifecycleStage {
  return typeof value === 'string' && (TREND_LIFECYCLE_STAGES as readonly string[]).includes(value);
}

/** Accepts what parses and has the fields that matter; drops anything malformed rather than
 *  failing the whole batch over one bad entry. */
function parseTrends(text: string): SynthesizedTrend[] | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  const trends = (parsed as { trends?: unknown }).trends;
  if (!Array.isArray(trends)) return undefined;
  const usable = trends.flatMap((t): SynthesizedTrend[] => {
    if (typeof t !== 'object' || t === null) return [];
    const row = t as Record<string, unknown>;
    if (typeof row.topicTitle !== 'string' || !row.topicTitle.trim()) return [];
    if (typeof row.summary !== 'string' || !row.summary.trim()) return [];
    const angles = row.creativeAngles as Partial<CreativeAngles> | undefined;
    if (!angles || !angles.contrarian || !angles.howTo || !angles.predictive) return [];
    return [
      {
        topicTitle: row.topicTitle,
        searchVolumeIndicator:
          typeof row.searchVolumeIndicator === 'string' ? row.searchVolumeIndicator : 'Moderate',
        velocityScore:
          typeof row.velocityScore === 'number'
            ? Math.max(1, Math.min(100, Math.round(row.velocityScore)))
            : 50,
        lifecycleStage: isLifecycleStage(row.lifecycleStage) ? row.lifecycleStage : 'rising',
        summary: row.summary,
        creativeAngles: {
          contrarian: String(angles.contrarian),
          howTo: String(angles.howTo),
          predictive: String(angles.predictive),
        },
        suggestedHooks: Array.isArray(row.suggestedHooks)
          ? row.suggestedHooks.filter((h): h is string => typeof h === 'string')
          : [],
        recommendedTags:
          typeof row.recommendedTags === 'object' && row.recommendedTags !== null
            ? (row.recommendedTags as RecommendedTags)
            : {},
        estimatedLifespan:
          typeof row.estimatedLifespan === 'string' ? row.estimatedLifespan : 'A few days',
      },
    ];
  });
  return usable.length > 0 ? usable : undefined;
}

/**
 * Clusters and writes up the signals for one niche. Never throws: a timeout, a provider error
 * or unusable output all come back as an empty list, which the caller treats as "nothing new
 * this tick" — a trend row already on the radar from a previous tick is left as it was rather
 * than cleared.
 */
export async function synthesizeTrends(
  request: TrendSynthesisRequest,
): Promise<SynthesizedTrend[]> {
  if (!request.provider || request.signals.length === 0) return [];

  const lines = request.signals
    .map((s) => `[${s.source}] ${s.title}${s.metric ? ` (${s.metric})` : ''}`)
    .join('\n');

  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    request.budgetMs ?? TREND_SYNTHESIS_BUDGET_MS,
  );
  try {
    const result = await request.provider.generate({
      prompt: `Niche: ${request.niche}\nRegion: ${request.region}\n\nSignals:\n${lines}`,
      system: SYSTEM,
      maxOutputTokens: 2000,
      temperature: 0.4,
      format: 'json',
      schema: schema(),
      signal: controller.signal,
    });
    const trends = parseTrends(result.text);
    if (!trends) {
      request.log?.warn({ niche: request.niche, provider: request.provider.key }, 'trend synthesis unusable');
      return [];
    }
    return trends;
  } catch (err) {
    request.log?.warn({ err, niche: request.niche }, 'trend synthesis failed');
    return [];
  } finally {
    clearTimeout(timer);
  }
}
