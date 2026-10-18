import { matchCaptionToTrends } from '@cgp/core';
import { apiError, apiWorkspace, jsonBody } from '@/server/api';
import { withRequestContext } from '@/server/request-context';
import { getDb } from '@/server/runtime';

type Context = { params: Promise<{ workspaceId: string }> };

/**
 * Compose's "Trend Fit" (WP62): how much of what Trend Radar has ingested this caption
 * already echoes, scored by plain lexical overlap against the live table — no LLM call, since
 * this runs on every pause while typing and a model call that often is neither free nor fast.
 */
export const POST = withRequestContext(async (request: Request, { params }: Context) => {
  const { workspaceId } = await params;
  const access = await apiWorkspace(workspaceId);
  if (!access.ok) return access.response;

  const body = (await jsonBody(request)) as { text?: unknown } | undefined;
  const text = typeof body?.text === 'string' ? body.text : '';
  if (!text.trim()) return apiError(422, 'invalid_input', { issues: [{ path: 'text', message: 'Write something first' }] });

  const fit = await matchCaptionToTrends(getDb(), text);
  return Response.json({ fit });
});
