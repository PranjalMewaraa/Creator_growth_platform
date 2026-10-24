import { sql } from 'drizzle-orm';
import { check, integer, jsonb, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createdAt, id, updatedAt } from './columns';
import { jobs } from './jobs';
import { outputs } from './content';
import { workspaceId } from './tenancy';

/** A named, revisitable board of independently-authored scenes (WP67) — distinct from the
 *  `storyboard` generator's one-shot, AI-planned sequence baked into a single output's metadata.
 *  Each scene here fires its own ordinary video-generation job; this table only groups them. */
export const storyboards = pgTable('storyboards', {
  id: id(),
  workspaceId: workspaceId(),
  name: text('name').notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const storyboardScenes = pgTable(
  'storyboard_scenes',
  {
    id: id(),
    workspaceId: workspaceId(),
    storyboardId: uuid('storyboard_id')
      .notNull()
      .references(() => storyboards.id, { onDelete: 'cascade' }),
    index: integer('index').notNull(),
    prompt: text('prompt').notNull().default(''),
    references: jsonb('references')
      .notNull()
      .default(sql`'[]'::jsonb`)
      .$type<Array<{ key: string; url: string; mimeType: string }>>(),
    status: text('status').notNull().default('draft'),
    jobId: uuid('job_id').references(() => jobs.id),
    outputId: uuid('output_id').references(() => outputs.id),
    videoUrl: text('video_url'),
    error: text('error'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('storyboard_scenes_order').on(t.storyboardId, t.index),
    check(
      'storyboard_scenes_status',
      sql`${t.status} IN ('draft', 'generating', 'complete', 'failed')`,
    ),
  ],
);
