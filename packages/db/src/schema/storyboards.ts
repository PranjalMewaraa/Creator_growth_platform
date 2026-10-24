import { sql } from 'drizzle-orm';
import { check, integer, jsonb, pgTable, real, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
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
  /** The stitched clip, once every scene has one and assembly has run (WP68). */
  finalVideoUrl: text('final_video_url'),
  finalOutputId: uuid('final_output_id').references(() => outputs.id),
  finalJobId: uuid('final_job_id').references(() => jobs.id),
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
    /** Fixed 8s for an Omni-generated clip; the real probed length for an uploaded one (WP68) —
     *  so assembly never has to re-probe, just read this column. */
    videoDurationSeconds: real('video_duration_seconds'),
    /** A still the creator uploaded directly for this scene (WP69) — mutually exclusive with
     *  videoUrl: held for videoDurationSeconds in the final video rather than animated, unlike
     *  a reference image (which stays in `references`, above, for Omni to animate from). */
    imageUrl: text('image_url'),
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
