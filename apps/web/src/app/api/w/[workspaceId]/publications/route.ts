import { currentCorrelationId } from '@cgp/config';
import { startPublication } from '@cgp/core';
import { scoped } from '@cgp/db';
import { apiError, apiWorkspace, jsonBody, refusal } from '@/server/api';
import { withRequestContext } from '@/server/request-context';
import { getDb, getLogger, getQueues } from '@/server/runtime';
import { getProviders } from '@/server/providers';

type Context = { params: Promise<{ workspaceId: string }> };

interface Body {
  text?: unknown;
  mediaKey?: unknown;
  instagramFrame?: unknown;
  accountIds?: unknown;
}

/**
 * Post now: `{ text, mediaKey?, instagramFrame?, accountIds }`. Answers 202 with the publication; each account
 * gets its own target, published by the worker, with its own status.
 */
export const POST = withRequestContext(async (request: Request, { params }: Context) => {
  const { workspaceId } = await params;
  const access = await apiWorkspace(workspaceId);
  if (!access.ok) return access.response;

  const body = ((await jsonBody(request)) ?? {}) as Body;
  if (
    typeof body.text !== 'string' ||
    !Array.isArray(body.accountIds) ||
    !body.accountIds.every((id) => typeof id === 'string') ||
    (body.mediaKey !== undefined && typeof body.mediaKey !== 'string') ||
    (body.instagramFrame !== undefined &&
      body.instagramFrame !== 'portrait' &&
      body.instagramFrame !== 'square')
  ) {
    return apiError(422, 'invalid_input', {
      issues: [{ path: '', message: 'Expected { text, mediaKey?, accountIds }' }],
    });
  }

  const workspace = await scoped(getDb(), workspaceId).workspace();
  const providers = getProviders();
  const result = await startPublication(
    {
      db: getDb(),
      queues: getQueues(),
      store: providers.store,
      moderation: providers.moderation,
      log: getLogger(),
    },
    {
      workspaceId,
      text: body.text,
      ...(body.mediaKey ? { media: { key: body.mediaKey } } : {}),
      ...(body.instagramFrame ? { instagramFrame: body.instagramFrame } : {}),
      accountIds: body.accountIds,
      timezone: workspace?.timezone ?? 'Asia/Kolkata',
      correlationId: currentCorrelationId(),
    },
  );
  if (!result.ok) return refusal(result);
  const location = `/api/w/${workspaceId}/publications/${result.publicationId}`;
  return Response.json(
    { publicationId: result.publicationId, status: location },
    { status: 202, headers: { location } },
  );
});
