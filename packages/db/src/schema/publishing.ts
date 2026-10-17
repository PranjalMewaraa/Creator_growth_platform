import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, id, platformEnum, postTargetStatusEnum, updatedAt } from './columns';
import { outputs, renditions } from './content';
import { workspaceId } from './tenancy';

export const socialAccounts = pgTable(
  'social_accounts',
  {
    id: id(),
    workspaceId: workspaceId(),
    platform: platformEnum('platform').notNull(),
    externalId: text('external_id').notNull(),
    displayName: text('display_name'),
    scopes: text('scopes')
      .array()
      .notNull()
      .default(sql`'{}'`),
    /** Envelope encrypted. The key lives outside the database (plan section 18). */
    tokenCiphertext: text('token_ciphertext').notNull(),
    tokenExpiresAt: timestamp('token_expires_at', { withTimezone: true }),
    health: text('health').notNull().default('ok'),
    /**
     * This row is the team's own account, made borrowable by other workspaces so a demo can
     * show real publishing without every visitor needing their own tester access on a
     * developer-mode app (WP52). False for everything connected through ordinary OAuth.
     */
    sharedDemo: boolean('shared_demo').notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('social_accounts_identity').on(t.workspaceId, t.platform, t.externalId)],
);

export const publications = pgTable(
  'publications',
  {
    id: id(),
    workspaceId: workspaceId(),
    scheduledAt: timestamp('scheduled_at', { withTimezone: true }).notNull(),
    timezone: text('timezone').notNull(),
    sourceOutputId: uuid('source_output_id').references(() => outputs.id),
    /** The shared source. Each target carries its own per platform body. */
    body: jsonb('body')
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: createdAt(),
  },
  (t) => [index('publications_workspace_scheduled').on(t.workspaceId, t.scheduledAt)],
);

/** Status lives here, never on the publication. Parent state is derived (plan section 14). */
export const postTargets = pgTable(
  'post_targets',
  {
    id: id(),
    workspaceId: workspaceId(),
    publicationId: uuid('publication_id')
      .notNull()
      .references(() => publications.id),
    socialAccountId: uuid('social_account_id')
      .notNull()
      .references(() => socialAccounts.id),
    status: postTargetStatusEnum('status').notNull().default('pending'),
    body: jsonb('body')
      .notNull()
      .default(sql`'{}'::jsonb`),
    renditionId: uuid('rendition_id').references(() => renditions.id),
    /** Platform draft id (Instagram container, LinkedIn upload), kept so polling survives a restart. */
    preparedRef: text('prepared_ref'),
    platformPostId: text('platform_post_id'),
    attemptCount: integer('attempt_count').notNull().default(0),
    lastError: jsonb('last_error'),
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
    /**
     * Set immediately before the irreversible publish call. A claimed target with this set and
     * no post id goes to needs_verification; without it, the attempt is safe to retry (A8).
     */
    publishStartedAt: timestamp('publish_started_at', { withTimezone: true }),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    /** The public link the platform gave for the post, when it gave one. */
    permalink: text('permalink'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('post_targets_one_per_account').on(t.publicationId, t.socialAccountId),
    uniqueIndex('post_targets_platform_post')
      .on(t.socialAccountId, t.platformPostId)
      .where(sql`platform_post_id IS NOT NULL`),
    index('post_targets_status').on(t.status),
    check(
      'post_targets_published_has_post_id',
      sql`status <> 'published' OR platform_post_id IS NOT NULL`,
    ),
  ],
);

export const slots = pgTable('slots', {
  id: id(),
  workspaceId: workspaceId(),
  recurrenceRule: text('recurrence_rule').notNull(),
  pillar: text('pillar'),
  platform: platformEnum('platform').notNull(),
  timeOfDay: time('time_of_day').notNull(),
  createdAt: createdAt(),
});
