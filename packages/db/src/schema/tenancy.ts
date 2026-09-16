import { sql } from 'drizzle-orm';
import { check, integer, pgTable, primaryKey, text, unique, uuid } from 'drizzle-orm/pg-core';
import { createdAt, id, membershipRoleEnum } from './columns';
import { users } from './catalog';

export const workspaces = pgTable(
  'workspaces',
  {
    id: id(),
    name: text('name').notNull(),
    timezone: text('timezone').notNull().default('Asia/Kolkata'),
    // Caches of SUM(credit_ledger) per currency, changed only in the same transaction as the entry.
    creditBalance: integer('credit_balance').notNull().default(0),
    videoSecondsBalance: integer('video_seconds_balance').notNull().default(0),
    videoSecondsCap: integer('video_seconds_cap').notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    check(
      'workspaces_balances_non_negative',
      sql`${t.creditBalance} >= 0 AND ${t.videoSecondsBalance} >= 0`,
    ),
  ],
);

/** Every tenant table carries this column (invariant 1). */
export const workspaceId = () =>
  uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id);

export const memberships = pgTable(
  'memberships',
  {
    workspaceId: workspaceId(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    role: membershipRoleEnum('role').notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.userId] })],
);

/** Versioned: every correction writes a new row, so lineage can point at the exact version. */
export const workspaceProfiles = pgTable(
  'workspace_profiles',
  {
    id: id(),
    workspaceId: workspaceId(),
    version: integer('version').notNull(),
    contentTypes: text('content_types')
      .array()
      .notNull()
      .default(sql`'{}'`),
    platforms: text('platforms')
      .array()
      .notNull()
      .default(sql`'{}'`),
    teamShape: text('team_shape'),
    goal90d: text('goal_90d'),
    cadence: text('cadence'),
    pillars: text('pillars')
      .array()
      .notNull()
      .default(sql`'{}'`),
    tone: text('tone'),
    language: text('language').notNull().default('en'),
    prohibitedWords: text('prohibited_words')
      .array()
      .notNull()
      .default(sql`'{}'`),
    createdAt: createdAt(),
  },
  (t) => [
    // Constraints, not indexes: composite FKs from compiled_prompts need them to exist first.
    unique('workspace_profiles_version').on(t.workspaceId, t.version),
  ],
);

export const brandKits = pgTable(
  'brand_kits',
  {
    id: id(),
    workspaceId: workspaceId(),
    version: integer('version').notNull(),
    logoUrl: text('logo_url'),
    colors: text('colors')
      .array()
      .notNull()
      .default(sql`'{}'`),
    typography: text('typography'),
    tagline: text('tagline'),
    createdAt: createdAt(),
  },
  (t) => [
    unique('brand_kits_version').on(t.workspaceId, t.version),
    check('brand_kits_three_colours_max', sql`cardinality(${t.colors}) <= 3`),
  ],
);
