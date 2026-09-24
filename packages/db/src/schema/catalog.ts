import type { MeteringRates } from '@cgp/contracts';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, id, outputTypeEnum } from './columns';

// Global catalog tables (plan section 8, A1): shared reference data with no workspace_id.
// Read through catalog(), written only by seed. Users live in ./identity (A11).

export const templates = pgTable('templates', {
  id: id(),
  slug: text('slug').notNull().unique(),
  outputType: outputTypeEnum('output_type').notNull(),
  currentVersion: integer('current_version').notNull().default(1),
  /** What the gallery calls it. Shown to people, so it is refreshed by every seed. */
  title: text('title').notNull().default(''),
  description: text('description').notNull().default(''),
  createdAt: createdAt(),
});

/** Immutable. Editing a template adds a version, so lineage never points at changed config. */
export const templateVersions = pgTable(
  'template_versions',
  {
    id: id(),
    templateId: uuid('template_id')
      .notNull()
      .references(() => templates.id),
    version: integer('version').notNull(),
    aspectRatio: text('aspect_ratio').notNull(),
    modelTier: text('model_tier').notNull(),
    compilerProfileRef: text('compiler_profile_ref').notNull(),
    styleParams: jsonb('style_params')
      .notNull()
      .default(sql`'{}'::jsonb`),
    postProcessing: jsonb('post_processing')
      .notNull()
      .default(sql`'{}'::jsonb`),
    costBand: text('cost_band').notNull(),
    /** duration, scene_count, motion, voiceover, caption_style. Null for non video templates. */
    videoDefaults: jsonb('video_defaults'),
    createdAt: createdAt(),
  },
  (t) => [
    // A constraint, not an index: the composite FK from compiled_prompts needs it to exist first.
    unique('template_versions_version').on(t.templateId, t.version),
  ],
);

/** Invariant 14: every preview is real output from that template version. */
export const templatePreviews = pgTable(
  'template_previews',
  {
    id: id(),
    templateVersionId: uuid('template_version_id')
      .notNull()
      .references(() => templateVersions.id),
    /** A picture's URL. Null for the templates whose output is words. */
    mediaUrl: text('media_url'),
    /** Generated words, kept inline: a caption preview is read, not fetched. */
    text: text('text'),
    isRealOutput: boolean('is_real_output').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    check('template_previews_real_output_only', sql`${t.isRealOutput}`),
    // A preview with neither is not a preview.
    check('template_previews_has_content', sql`${t.mediaUrl} IS NOT NULL OR ${t.text} IS NOT NULL`),
    // One preview per template version, replaced when it is generated again.
    unique('template_previews_once').on(t.templateVersionId),
  ],
);

/** Versioned config, changeable without a deploy. */
export const compilerProfiles = pgTable(
  'compiler_profiles',
  {
    id: id(),
    key: text('key').notNull(),
    outputType: outputTypeEnum('output_type').notNull(),
    version: integer('version').notNull(),
    config: jsonb('config').notNull(),
    createdAt: createdAt(),
  },
  // A constraint, not an index: the composite FK from compiled_prompts needs it to exist first.
  (t) => [unique('compiler_profiles_version').on(t.key, t.version)],
);

/** Credit costs live in config, not code (FR-BL-01). */
export const meteringRates = pgTable('metering_rates', {
  id: id(),
  version: integer('version').notNull().unique(),
  credits: jsonb('credits').notNull().$type<MeteringRates['credits']>(),
  effectiveFrom: timestamp('effective_from', { withTimezone: true }).notNull().defaultNow(),
});

/** A licence is recorded per track (FR-VD-08). */
export const musicTracks = pgTable('music_tracks', {
  id: id(),
  title: text('title').notNull(),
  storageKey: text('storage_key').notNull(),
  licence: jsonb('licence').notNull(),
  createdAt: createdAt(),
});
