import { generators } from '@cgp/core';
import { apiWorkspace } from '@/server/api';
import { withRequestContext } from '@/server/request-context';

type Context = { params: Promise<{ workspaceId: string }> };

/** Every registered generator, so Studio can build its choices from the registry. */
export const GET = withRequestContext(async (_request: Request, { params }: Context) => {
  const { workspaceId } = await params;
  const access = await apiWorkspace(workspaceId);
  if (!access.ok) return access.response;

  return Response.json({
    generators: generators.list().map(({ key, outputType, jobClass }) => ({
      key,
      outputType,
      jobClass,
    })),
  });
});
