import { editCompiledPrompt } from '@cgp/orchestration';
import { apiError, apiWorkspace, jsonBody } from '@/server/api';
import { withRequestContext } from '@/server/request-context';
import { getDb } from '@/server/runtime';

type Context = { params: Promise<{ workspaceId: string; promptId: string }> };

const MAX_EDIT_CHARS = 8000;

/**
 * A user edit: `{ "text": "..." }` becomes a new version whose parent is this prompt (201).
 * An edit that changes nothing answers 200 with the prompt as it was.
 */
export const POST = withRequestContext(async (request: Request, { params }: Context) => {
  const { workspaceId, promptId } = await params;
  const access = await apiWorkspace(workspaceId);
  if (!access.ok) return access.response;

  const body = await jsonBody(request);
  const text = body && typeof body === 'object' && 'text' in body ? body.text : undefined;
  if (typeof text !== 'string' || text.length > MAX_EDIT_CHARS) {
    return apiError(422, 'invalid_input', {
      issues: [{ path: 'text', message: `Text of at most ${MAX_EDIT_CHARS} characters` }],
    });
  }

  const result = await editCompiledPrompt(getDb(), workspaceId, promptId, text);
  if (!result.ok) {
    return result.reason === 'not_found'
      ? apiError(404, 'prompt_not_found')
      : apiError(422, 'invalid_input', {
          issues: [{ path: 'text', message: 'The brief is empty' }],
        });
  }
  return Response.json({ prompt: result.prompt }, { status: result.changed ? 201 : 200 });
});
