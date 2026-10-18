import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, id, trendLifecycleEnum, trendSourceEnum, updatedAt } from './columns';
import { users } from './identity';
import { workspaceId } from './tenancy';

// Trend Radar (WP61): ingested and synthesised by the worker on a timer, read by every
// workspace. Global like the catalog tables in ./catalog, but written at runtime rather than
// only by seed, so it is deliberately not one of CATALOG_TABLES (catalog() stays read only —
// see packages/db/src/catalog.ts) and not workspace scoped either (a trend is not one tenant's
// data to begin with). Read and written through packages/db/src/trends.ts, the same way the
// music catalogue is (packages/db/src/music.ts), the nearest precedent for a global table a
// typed module writes to directly rather than through catalog() or scoped().

export const trendingTopics = pgTable(
  'trending_topics',
  {
    id: id(),
    niche: text('niche').notNull(),
    region: text('region').notNull().default('global'),
    topicTitle: text('topic_title').notNull(),
    /** A human reading, not a number: "High (Breakout)", "Moderate". Null until a source says. */
    searchVolumeIndicator: text('search_volume_indicator'),
    velocityScore: integer('velocity_score').notNull().default(50),
    lifecycleStage: trendLifecycleEnum('lifecycle_stage').notNull().default('rising'),
    sourcePlatform: trendSourceEnum('source_platform').notNull(),
    summary: text('summary').notNull(),
    /** { contrarian, howTo, predictive } — CreativeAngles in @cgp/contracts. */
    creativeAngles: jsonb('creative_angles').notNull(),
    suggestedHooks: text('suggested_hooks')
      .array()
      .notNull()
      .default(sql`'{}'`),
    /** { tiktok?, instagram?, youtube?, linkedin? } — RecommendedTags in @cgp/contracts. */
    recommendedTags: jsonb('recommended_tags').notNull(),
    estimatedLifespan: text('estimated_lifespan'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check(
      'trending_topics_velocity_range',
      sql`${t.velocityScore} >= 1 AND ${t.velocityScore} <= 100`,
    ),
    // Re-ingesting the same topic for the same niche and region updates it in place (the
    // worker upserts on this), rather than piling up a new row every tick.
    unique('trending_topics_dedupe').on(t.niche, t.region, t.topicTitle),
  ],
);

/** A trend a member bookmarked, workspace scoped like any other tenant data (invariant 1) —
 *  unlike the trend itself, saving one is this workspace's own act. */
export const trendBookmarks = pgTable(
  'trend_bookmarks',
  {
    workspaceId: workspaceId(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    trendId: uuid('trend_id')
      .notNull()
      .references(() => trendingTopics.id, { onDelete: 'cascade' }),
    usedInScript: boolean('used_in_script').notNull().default(false),
    savedAt: timestamp('saved_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.userId, t.trendId] })],
);
