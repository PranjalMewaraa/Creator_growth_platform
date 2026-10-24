import { currentCorrelationId } from '@cgp/config';
import { generators, startGeneration } from '@cgp/core';
import { findStoryboard, setSceneJob } from '@cgp/db';
import { apiError, apiWorkspace, refusal } from '@/server/api';
import { withRequestContext } from '@/server/request-context';
import { getDb, getLogger, getQueues } from '@/server/runtime';
import { getProviders } from '@/server/providers';

type Context = { params: Promise<{ workspaceId: string; storyboardId: string; sceneId: string }> };

/** One scene's clip, filmed with Omni — same single-clip `video` generation Studio's own Video
 *  kind already uses, just with the model forced and the scene's own prompt/references. */
export const POST = withRequestContext(async (_request: Request, { params }: Context) => {
  const { workspaceId, storyboardId, sceneId } = await params;
  const access = await apiWorkspace(workspaceId);
  if (!access.ok) return access.response;

  const board = await findStoryboard(getDb(), workspaceId, storyboardId);
  const scene = board?.scenes.find((s) => s.id === sceneId);
  if (!scene) return apiError(404, 'scene_not_found');
  if (!scene.prompt.trim()) {
    return apiError(422, 'invalid_input', {
      issues: [{ path: 'prompt', message: 'Write what happens in this scene' }],
    });
  }

  const providers = getProviders();
  const result = await startGeneration(
    {
      db: getDb(),
      queues: getQueues(),
      log: getLogger(),
      registry: generators,
      compile: { rewriters: providers.rewriters, log: getLogger(), rewriteBudgetMs: 6000 },
      moderation: providers.moderation,
    },
    {
      workspaceId,
      generatorKey: 'video',
      input: {
        intentText: scene.prompt.trim(),
        targetPlatform: 'instagram',
        aspectRatio: '16:9',
        targetDurationSeconds: 8,
        voiceover: false,
        videoModel: 'gemini-omni-1.1-flash',
        ...(scene.references.length > 0
          ? { referenceImageKeys: scene.references.map((r) => r.key) }
          : {}),
      },
      correlationId: currentCorrelationId(),
    },
  );
  if (!result.ok) return refusal(result);

  await setSceneJob(getDb(), workspaceId, sceneId, result.job.id);
  return Response.json({ job: result.job }, { status: 202 });
});
