import type { ResolvedSetting } from '@cgp/contracts';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { compilerProfiles, templates, templateVersions } from './catalog';
import { createdAt, id, outputTypeEnum, platformEnum } from './columns';
import { jobs } from './jobs';
import { brandKits, workspaceId, workspaceProfiles } from './tenancy';

/**
 * Invariant 8: persisted with lineage to intent, template version, profile version, brand kit
 * version and compiler profile version. The composite foreign keys make lineage point at rows
 * that exist. A user edit is a new row whose parent_id is the prompt it was edited from.
 */
export const compiledPrompts = pgTable(
  'compiled_prompts',
  {
    id: id(),
    workspaceId: workspaceId(),
    jobId: uuid('job_id').references(() => jobs.id),
    parentId: uuid('parent_id').references((): AnyPgColumn => compiledPrompts.id),
    text: text('text').notNull(),
    intentText: text('intent_text').notNull(),
    templateId: uuid('template_id')
      .notNull()
      .references(() => templates.id),
    templateVersion: integer('template_version').notNull(),
    profileVersion: integer('profile_version').notNull(),
    brandKitVersion: integer('brand_kit_version').notNull(),
    compilerProfileVersion: integer('compiler_profile_version').notNull(),
    /** Which compiler profile the version belongs to, such as `script.en`. */
    compilerProfileKey: text('compiler_profile_key').notNull(),
    outputType: outputTypeEnum('output_type').notNull(),
    language: text('language').notNull().default('en'),
    /** The resolved settings (stage 1), so an edit re-applies the same requirements. */
    settings: jsonb('settings')
      .notNull()
      .default(sql`'[]'::jsonb`)
      .$type<ResolvedSetting[]>(),
    userEdited: boolean('user_edited').notNull().default(false),
    fallbackUsed: boolean('fallback_used').notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    index('compiled_prompts_job').on(t.jobId),
    foreignKey({
      name: 'compiled_prompts_template_version_fk',
      columns: [t.templateId, t.templateVersion],
      foreignColumns: [templateVersions.templateId, templateVersions.version],
    }),
    foreignKey({
      name: 'compiled_prompts_profile_version_fk',
      columns: [t.workspaceId, t.profileVersion],
      foreignColumns: [workspaceProfiles.workspaceId, workspaceProfiles.version],
    }),
    foreignKey({
      name: 'compiled_prompts_brand_kit_version_fk',
      columns: [t.workspaceId, t.brandKitVersion],
      foreignColumns: [brandKits.workspaceId, brandKits.version],
    }),
    foreignKey({
      name: 'compiled_prompts_compiler_profile_fk',
      columns: [t.compilerProfileKey, t.compilerProfileVersion],
      foreignColumns: [compilerProfiles.key, compilerProfiles.version],
    }),
  ],
);

export const outputs = pgTable(
  'outputs',
  {
    id: id(),
    workspaceId: workspaceId(),
    jobId: uuid('job_id')
      .notNull()
      .references(() => jobs.id),
    kind: outputTypeEnum('kind').notNull(),
    storageKey: text('storage_key').notNull(),
    metadata: jsonb('metadata')
      .notNull()
      .default(sql`'{}'::jsonb`),
    compiledPromptId: uuid('compiled_prompt_id')
      .notNull()
      .references(() => compiledPrompts.id),
    templateId: uuid('template_id')
      .notNull()
      .references(() => templates.id),
    brandKitVersion: integer('brand_kit_version').notNull(),
    /** Any output can become another generator's input (FR-GN-10). */
    parentOutputId: uuid('parent_output_id').references((): AnyPgColumn => outputs.id),
    createdAt: createdAt(),
  },
  (t) => [index('outputs_workspace_created').on(t.workspaceId, t.createdAt)],
);

export const videoScenes = pgTable(
  'video_scenes',
  {
    id: id(),
    workspaceId: workspaceId(),
    outputId: uuid('output_id')
      .notNull()
      .references(() => outputs.id),
    index: integer('index').notNull(),
    clipUrl: text('clip_url'),
    durationS: real('duration_s'),
    prompt: text('prompt').notNull(),
    regeneratedCount: integer('regenerated_count').notNull().default(0),
  },
  (t) => [uniqueIndex('video_scenes_order').on(t.outputId, t.index)],
);

/** Derived once per platform spec and cached. */
export const renditions = pgTable(
  'renditions',
  {
    id: id(),
    workspaceId: workspaceId(),
    outputId: uuid('output_id')
      .notNull()
      .references(() => outputs.id),
    platform: platformEnum('platform').notNull(),
    spec: jsonb('spec').notNull(),
    storageKey: text('storage_key').notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('renditions_once_per_platform').on(t.outputId, t.platform)],
);

/**
 * What a creator changed before accepting an output (WP20). The evaluation set says which
 * prompt a judge prefers; this says what the engine costs in edits on real work, which is the
 * number to quote once there is enough of it.
 */
export const outputEdits = pgTable('output_edits', {
  id: id(),
  workspaceId: workspaceId(),
  outputId: uuid('output_id')
    .notNull()
    .references(() => outputs.id),
  /** Characters changed, and that as a share of the longer text. */
  distance: integer('distance').notNull(),
  rate: real('rate').notNull(),
  generatedChars: integer('generated_chars').notNull(),
  acceptedChars: integer('accepted_chars').notNull(),
  createdAt: createdAt(),
});

export const moderationEvents = pgTable(
  'moderation_events',
  {
    id: id(),
    workspaceId: workspaceId(),
    /**
     * `compiled_prompt` is the pre check before dispatch (invariant 10). `job` is the post
     * check on what came back, which is recorded against the job because a blocked output is
     * never stored. `output` is for a check on something already kept.
     */
    subjectType: text('subject_type').notNull(),
    subjectId: uuid('subject_id').notNull(),
    verdict: text('verdict').notNull(),
    category: text('category'),
    createdAt: createdAt(),
  },
  (t) => [
    check('moderation_events_subject', sql`subject_type IN ('compiled_prompt', 'output', 'job')`),
    check('moderation_events_verdict', sql`verdict IN ('allowed', 'blocked')`),
    index('moderation_events_subject_idx').on(t.subjectType, t.subjectId),
  ],
);
