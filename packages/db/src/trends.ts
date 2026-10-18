import { and, desc, eq, sql } from 'drizzle-orm';
import type {
  CreativeAngles,
  RecommendedTags,
  TrendLifecycleStage,
  TrendSource,
} from '@cgp/contracts';
import { unwrap, type Database } from './client';
import { scoped } from './scoped';
import { trendBookmarks, trendingTopics } from './schema';

export type TrendRow = typeof trendingTopics.$inferSelect;
export type TrendBookmarkRow = typeof trendBookmarks.$inferSelect;

export interface UpsertTrend {
  niche: string;
  region: string;
  topicTitle: string;
  searchVolumeIndicator?: string | null;
  velocityScore: number;
  lifecycleStage: TrendLifecycleStage;
  sourcePlatform: TrendSource;
  summary: string;
  creativeAngles: CreativeAngles;
  suggestedHooks: string[];
  recommendedTags: RecommendedTags;
  estimatedLifespan?: string | null;
}

/**
 * Written by the ingestion pass, one row per (niche, region, topicTitle) — a topic seen again
 * refreshes the same row rather than piling up a new one each tick (`trending_topics_dedupe`).
 */
export async function upsertTrend(db: Database, trend: UpsertTrend): Promise<TrendRow> {
  const [row] = await unwrap(db)
    .insert(trendingTopics)
    .values(trend)
    .onConflictDoUpdate({
      target: [trendingTopics.niche, trendingTopics.region, trendingTopics.topicTitle],
      set: {
        searchVolumeIndicator: trend.searchVolumeIndicator,
        velocityScore: trend.velocityScore,
        lifecycleStage: trend.lifecycleStage,
        sourcePlatform: trend.sourcePlatform,
        summary: trend.summary,
        creativeAngles: trend.creativeAngles,
        suggestedHooks: trend.suggestedHooks,
        recommendedTags: trend.recommendedTags,
        estimatedLifespan: trend.estimatedLifespan,
        updatedAt: sql`now()`,
      },
    })
    .returning();
  if (!row) throw new Error('Trend upsert returned no row');
  return row;
}

/** The radar's own list: newest signal first within a niche, strongest first inside that. */
export async function listTrends(
  db: Database,
  filter: { niche?: string; region?: string; limit?: number } = {},
): Promise<TrendRow[]> {
  const d = unwrap(db);
  const conditions = [
    filter.niche ? eq(trendingTopics.niche, filter.niche) : undefined,
    filter.region ? eq(trendingTopics.region, filter.region) : undefined,
  ].filter((c) => c !== undefined);
  return d
    .select()
    .from(trendingTopics)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(trendingTopics.velocityScore), desc(trendingTopics.updatedAt))
    .limit(filter.limit ?? 50);
}

export async function findTrend(db: Database, id: string): Promise<TrendRow | undefined> {
  const [row] = await unwrap(db).select().from(trendingTopics).where(eq(trendingTopics.id, id));
  return row;
}

/** Every niche a trend has been ingested for, for the radar's own filter dropdown. */
export async function listTrendNiches(db: Database): Promise<string[]> {
  const rows = await unwrap(db)
    .selectDistinct({ niche: trendingTopics.niche })
    .from(trendingTopics)
    .orderBy(trendingTopics.niche);
  return rows.map((r) => r.niche);
}

/** Bookmarking is this workspace's own act, unlike the trend itself (invariant 1). */
export async function saveTrendBookmark(
  db: Database,
  workspaceId: string,
  userId: string,
  trendId: string,
): Promise<void> {
  await scoped(db, workspaceId).insert(trendBookmarks, {
    userId,
    trendId,
    usedInScript: false,
    savedAt: new Date(),
  });
}

export async function removeTrendBookmark(
  db: Database,
  workspaceId: string,
  userId: string,
  trendId: string,
): Promise<void> {
  await scoped(db, workspaceId).delete(trendBookmarks, (t, op) =>
    op.and(op.eq(t.userId, userId), op.eq(t.trendId, trendId)),
  );
}

/** Which of these trend ids this member has already saved, for the radar's bookmark state. */
export async function bookmarkedTrendIds(
  db: Database,
  workspaceId: string,
  userId: string,
  trendIds: string[],
): Promise<Set<string>> {
  if (trendIds.length === 0) return new Set();
  const rows = await scoped(db, workspaceId).select(trendBookmarks, {
    where: (t, op) => op.and(op.eq(t.userId, userId), op.inArray(t.trendId, trendIds)),
  });
  return new Set(rows.map((r) => r.trendId));
}
