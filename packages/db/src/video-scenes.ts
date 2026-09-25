import { and, asc, eq, sql } from 'drizzle-orm';
import { unwrap, type Database } from './client';
import { videoScenes } from './schema';

export type VideoSceneRow = typeof videoScenes.$inferSelect;

/**
 * The scenes of one video output (WP22). Written once when the render plans them, then each
 * one updated as its clip arrives, so a render that dies halfway leaves a readable record of
 * what was made and what was not.
 */
export async function createScenes(
  db: Database,
  workspaceId: string,
  outputId: string,
  prompts: string[],
): Promise<VideoSceneRow[]> {
  if (prompts.length === 0) throw new Error('A video needs at least one scene');
  return unwrap(db)
    .insert(videoScenes)
    .values(prompts.map((prompt, index) => ({ workspaceId, outputId, index, prompt })))
    .returning();
}

/** A scene's clip, once it has been generated and stored. */
export async function setSceneClip(
  db: Database,
  workspaceId: string,
  sceneId: string,
  clip: { clipUrl: string; durationS: number },
): Promise<void> {
  await unwrap(db)
    .update(videoScenes)
    .set(clip)
    .where(and(eq(videoScenes.id, sceneId), eq(videoScenes.workspaceId, workspaceId)));
}

/**
 * A scene generated again, in place: the clip is replaced and the count goes up, because how
 * often a scene had to be redone is worth knowing before the demo claims otherwise.
 */
export async function replaceSceneClip(
  db: Database,
  workspaceId: string,
  sceneId: string,
  clip: { clipUrl: string; durationS: number },
): Promise<void> {
  await unwrap(db)
    .update(videoScenes)
    .set({ ...clip, regeneratedCount: sql`${videoScenes.regeneratedCount} + 1` })
    .where(and(eq(videoScenes.id, sceneId), eq(videoScenes.workspaceId, workspaceId)));
}

export async function listScenes(
  db: Database,
  workspaceId: string,
  outputId: string,
): Promise<VideoSceneRow[]> {
  return unwrap(db)
    .select()
    .from(videoScenes)
    .where(and(eq(videoScenes.workspaceId, workspaceId), eq(videoScenes.outputId, outputId)))
    .orderBy(asc(videoScenes.index));
}

export async function findScene(
  db: Database,
  workspaceId: string,
  sceneId: string,
): Promise<VideoSceneRow | undefined> {
  const [row] = await unwrap(db)
    .select()
    .from(videoScenes)
    .where(and(eq(videoScenes.id, sceneId), eq(videoScenes.workspaceId, workspaceId)));
  return row;
}
