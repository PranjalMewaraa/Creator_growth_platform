import { calendarWeek } from '@cgp/core';
import { apiError, apiWorkspace } from '@/server/api';
import { withRequestContext } from '@/server/request-context';
import { getDb } from '@/server/runtime';

type Context = { params: Promise<{ workspaceId: string }> };

/** Nothing sensible asks for more than a month at a time, and a typo should not scan a year. */
const MAX_SPAN_MS = 40 * 24 * 60 * 60_000;

/**
 * The posts due in a stretch of time: `?from=<iso>&to=<iso>` (WP34). The calendar asks for its
 * own week, because which week that is depends on the viewer's clock and timezone, which the
 * server cannot know.
 */
export const GET = withRequestContext(async (request: Request, { params }: Context) => {
  const { workspaceId } = await params;
  const access = await apiWorkspace(workspaceId);
  if (!access.ok) return access.response;

  const url = new URL(request.url);
  const from = new Date(url.searchParams.get('from') ?? '');
  const to = new Date(url.searchParams.get('to') ?? '');
  const bad = (message: string) =>
    apiError(422, 'invalid_input', { issues: [{ path: '', message }] });
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()))
    return bad('Expected from and to as ISO instants');
  if (to <= from) return bad('to must be after from');
  if (to.getTime() - from.getTime() > MAX_SPAN_MS) return bad('Ask for a month at most');

  return Response.json({ posts: await calendarWeek(getDb(), workspaceId, from, to) });
});
