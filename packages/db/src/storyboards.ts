import type { Database } from './client';
import { scoped } from './scoped';
import { storyboards, storyboardScenes } from './schema';

export type StoryboardRow = typeof storyboards.$inferSelect;
export type StoryboardSceneRow = typeof storyboardScenes.$inferSelect;
export type StoryboardWithScenes = StoryboardRow & { scenes: StoryboardSceneRow[] };

export async function createStoryboard(
  db: Database,
  workspaceId: string,
  name: string,
): Promise<StoryboardRow> {
  const [row] = await scoped(db, workspaceId).insert(storyboards, { name });
  if (!row) throw new Error('Storyboard insert returned no row');
  return row;
}

export async function listStoryboards(
  db: Database,
  workspaceId: string,
): Promise<Array<StoryboardRow & { sceneCount: number }>> {
  const ws = scoped(db, workspaceId);
  const [boards, scenes] = await Promise.all([
    ws.select(storyboards, { orderBy: (t, order) => order.desc(t.createdAt) }),
    ws.select(storyboardScenes),
  ]);
  const counts = new Map<string, number>();
  for (const scene of scenes) counts.set(scene.storyboardId, (counts.get(scene.storyboardId) ?? 0) + 1);
  return boards.map((board) => ({ ...board, sceneCount: counts.get(board.id) ?? 0 }));
}

export async function findStoryboard(
  db: Database,
  workspaceId: string,
  storyboardId: string,
): Promise<StoryboardWithScenes | undefined> {
  const ws = scoped(db, workspaceId);
  const [[board], scenes] = await Promise.all([
    ws.select(storyboards, { where: (t, op) => op.eq(t.id, storyboardId) }),
    ws.select(storyboardScenes, {
      where: (t, op) => op.eq(t.storyboardId, storyboardId),
      orderBy: (t, order) => order.asc(t.index),
    }),
  ]);
  if (!board) return undefined;
  return { ...board, scenes };
}

export async function renameStoryboard(
  db: Database,
  workspaceId: string,
  storyboardId: string,
  name: string,
): Promise<void> {
  await scoped(db, workspaceId).update(storyboards, { name }, (t, op) => op.eq(t.id, storyboardId));
}

export async function deleteStoryboard(
  db: Database,
  workspaceId: string,
  storyboardId: string,
): Promise<void> {
  // storyboard_scenes cascades on the FK, so only the board itself needs deleting.
  await scoped(db, workspaceId).delete(storyboards, (t, op) => op.eq(t.id, storyboardId));
}

export async function addScene(
  db: Database,
  workspaceId: string,
  storyboardId: string,
): Promise<StoryboardSceneRow> {
  const ws = scoped(db, workspaceId);
  const existing = await ws.select(storyboardScenes, {
    where: (t, op) => op.eq(t.storyboardId, storyboardId),
  });
  const nextIndex = existing.reduce((max, s) => Math.max(max, s.index), -1) + 1;
  const [row] = await ws.insert(storyboardScenes, { storyboardId, index: nextIndex });
  if (!row) throw new Error('Scene insert returned no row');
  return row;
}

export async function updateScene(
  db: Database,
  workspaceId: string,
  sceneId: string,
  set: { prompt?: string; references?: StoryboardSceneRow['references'] },
): Promise<void> {
  await scoped(db, workspaceId).update(storyboardScenes, set, (t, op) => op.eq(t.id, sceneId));
}

export async function removeScene(
  db: Database,
  workspaceId: string,
  sceneId: string,
): Promise<void> {
  await scoped(db, workspaceId).delete(storyboardScenes, (t, op) => op.eq(t.id, sceneId));
}

export async function setSceneJob(
  db: Database,
  workspaceId: string,
  sceneId: string,
  jobId: string,
): Promise<void> {
  await scoped(db, workspaceId).update(
    storyboardScenes,
    { jobId, status: 'generating', error: null },
    (t, op) => op.eq(t.id, sceneId),
  );
}

export async function setSceneResult(
  db: Database,
  workspaceId: string,
  sceneId: string,
  result: { outputId: string; videoUrl: string; durationSeconds?: number },
): Promise<void> {
  const { durationSeconds, ...rest } = result;
  await scoped(db, workspaceId).update(
    storyboardScenes,
    { ...rest, videoDurationSeconds: durationSeconds ?? null, status: 'complete', error: null },
    (t, op) => op.eq(t.id, sceneId),
  );
}

/** A clip the creator uploaded directly, skipping generation for this scene entirely —
 *  no outputId, since nothing was generated (WP68). */
export async function setSceneUploadedClip(
  db: Database,
  workspaceId: string,
  sceneId: string,
  clip: { videoUrl: string; durationSeconds: number },
): Promise<void> {
  await scoped(db, workspaceId).update(
    storyboardScenes,
    {
      videoUrl: clip.videoUrl,
      videoDurationSeconds: clip.durationSeconds,
      outputId: null,
      jobId: null,
      status: 'complete',
      error: null,
    },
    (t, op) => op.eq(t.id, sceneId),
  );
}

/** Removes an uploaded clip, back to a blank scene a prompt can fill in (WP68). */
export async function clearSceneClip(
  db: Database,
  workspaceId: string,
  sceneId: string,
): Promise<void> {
  await scoped(db, workspaceId).update(
    storyboardScenes,
    {
      videoUrl: null,
      videoDurationSeconds: null,
      outputId: null,
      jobId: null,
      status: 'draft',
      error: null,
    },
    (t, op) => op.eq(t.id, sceneId),
  );
}

export async function setSceneFailed(
  db: Database,
  workspaceId: string,
  sceneId: string,
  error: string,
): Promise<void> {
  await scoped(db, workspaceId).update(
    storyboardScenes,
    { status: 'failed', error },
    (t, op) => op.eq(t.id, sceneId),
  );
}

export async function setBoardAssembling(
  db: Database,
  workspaceId: string,
  storyboardId: string,
  jobId: string,
): Promise<void> {
  await scoped(db, workspaceId).update(
    storyboards,
    { finalJobId: jobId },
    (t, op) => op.eq(t.id, storyboardId),
  );
}

export async function setBoardAssembled(
  db: Database,
  workspaceId: string,
  storyboardId: string,
  result: { outputId: string; finalVideoUrl: string },
): Promise<void> {
  await scoped(db, workspaceId).update(
    storyboards,
    { finalOutputId: result.outputId, finalVideoUrl: result.finalVideoUrl },
    (t, op) => op.eq(t.id, storyboardId),
  );
}
