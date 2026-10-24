import { currentCorrelationId } from '@cgp/config';
import { generators, startGeneration } from '@cgp/core';
import { findStoryboard, setSceneJob } from '@cgp/db';
import { apiError, apiWorkspace } from '@/server/api';
import { withRequestContext } from '@/server/request-context';
import { getDb, getLogger, getQueues } from '@/server/runtime';
import { getProviders } from '@/server/providers';

type Context = { params: Promise<{ workspaceId: string; storyboardId: string }> };

/** Fires one generation job per scene that still needs one. Omni's own pacer
 *  (packages/adapters/src/video/omni.ts) serializes the real API calls, so starting every
 *  job at once is safe — no extra queuing logic needed here. */
export const POST = withRequestContext(async (_request: Request, { params }: Context) => {
  const { workspaceId, storyboardId } = await params;
  const access = await apiWorkspace(workspaceId);
  if (!access.ok) return access.response;

  const board = await findStoryboard(getDb(), workspaceId, storyboardId);
  if (!board) return apiError(404, 'storyboard_not_found');

  const pending = board.scenes.filter(
    (scene) => scene.status !== 'complete' && scene.status !== 'generating' && scene.prompt.trim(),
  );

  const providers = getProviders();
  const deps = {
    db: getDb(),
    queues: getQueues(),
    log: getLogger(),
    registry: generators,
    compile: { rewriters: providers.rewriters, log: getLogger(), rewriteBudgetMs: 6000 },
    moderation: providers.moderation,
  };

  const started: string[] = [];
  const failed: Array<{ sceneId: string; reason: string }> = [];
  for (const scene of pending) {
    const result = await startGeneration(deps, {
      workspaceId,
      generatorKey: 'video',
      input: {
        intentText: scene.prompt.trim(),
        targetPlatform: 'instagram',
        aspectRatio: '16:9',
        targetDurationSeconds: 8,
        voiceover: true,
        videoModel: 'gemini-omni-1.1-flash',
        ...(scene.references.length > 0
          ? { referenceImageKeys: scene.references.map((r) => r.key) }
          : {}),
      },
      correlationId: currentCorrelationId(),
    });
    if (result.ok) {
      await setSceneJob(getDb(), workspaceId, scene.id, result.job.id);
      started.push(scene.id);
    } else {
      failed.push({ sceneId: scene.id, reason: result.reason });
    }
  }

  return Response.json({ started, failed });
});
