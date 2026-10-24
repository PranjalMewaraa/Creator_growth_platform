import { currentCorrelationId } from '@cgp/config';
import { generators, startGeneration } from '@cgp/core';
import { findStoryboard, setBoardAssembling } from '@cgp/db';
import { apiError, apiWorkspace, refusal } from '@/server/api';
import { withRequestContext } from '@/server/request-context';
import { getDb, getLogger, getQueues } from '@/server/runtime';
import { getProviders } from '@/server/providers';

type Context = { params: Promise<{ workspaceId: string; storyboardId: string }> };

/** Stitches every scene's clip (generated or uploaded) into one final video. Refuses up front,
 *  job-free, if any scene still has no clip — cheaper and faster than letting the worker find
 *  out (WP68). */
export const POST = withRequestContext(async (_request: Request, { params }: Context) => {
  const { workspaceId, storyboardId } = await params;
  const access = await apiWorkspace(workspaceId);
  if (!access.ok) return access.response;

  const board = await findStoryboard(getDb(), workspaceId, storyboardId);
  if (!board) return apiError(404, 'storyboard_not_found');
  if (board.scenes.length === 0) {
    return apiError(422, 'invalid_input', { issues: [{ path: 'scenes', message: 'Add a scene first' }] });
  }
  const missing = board.scenes.find((scene) => !scene.videoUrl);
  if (missing) {
    return apiError(422, 'invalid_input', {
      issues: [{ path: 'scenes', message: `Scene ${missing.index + 1} has no clip yet` }],
    });
  }

  const providers = getProviders();
  const result = await startGeneration(
    {
      db: getDb(),
      queues: getQueues(),
      log: getLogger(),
      registry: generators,
      compile: { rewriters: providers.rewriters, log: getLogger() },
      moderation: providers.moderation,
    },
    {
      workspaceId,
      generatorKey: 'storyboard_assemble',
      input: { intentText: 'Assemble storyboard', targetPlatform: null, storyboardId },
      correlationId: currentCorrelationId(),
    },
  );
  if (!result.ok) return refusal(result);

  await setBoardAssembling(getDb(), workspaceId, storyboardId, result.job.id);
  return Response.json({ job: result.job }, { status: 202 });
});
