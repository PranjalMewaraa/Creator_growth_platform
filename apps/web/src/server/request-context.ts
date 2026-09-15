import 'server-only';
import { currentCorrelationId, withCorrelation } from '@cgp/config';

export const CORRELATION_HEADER = 'x-correlation-id';

// Incoming ids end up in logs, so only accept short plain tokens.
const SAFE_ID = /^[A-Za-z0-9_-]{8,64}$/;

/**
 * Wraps a route handler so everything it logs, compiles or enqueues carries one
 * correlation id. Reuses the caller's id when it is safe, and echoes it back.
 */
export function withRequestContext<Args extends unknown[]>(
  handler: (request: Request, ...args: Args) => Response | Promise<Response>,
) {
  return (request: Request, ...args: Args): Promise<Response> => {
    const incoming = request.headers.get(CORRELATION_HEADER);
    const id = incoming && SAFE_ID.test(incoming) ? incoming : undefined;
    return withCorrelation(id, async () => {
      const response = await handler(request, ...args);
      response.headers.set(CORRELATION_HEADER, currentCorrelationId() ?? '');
      return response;
    });
  };
}
