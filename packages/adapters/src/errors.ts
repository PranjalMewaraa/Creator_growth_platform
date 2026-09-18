import type { Logger } from '@cgp/config';
import { AdapterError, isAdapterError, type FailureCategory } from '@cgp/contracts';

/**
 * What a caller should do about an HTTP status (plan section 14). No status means the request
 * never got an answer: a network failure, worth retrying. 401 and 403 are terminal rather than
 * reauth: for a model provider they mean our own credentials or permissions are wrong, which a
 * retry will not fix. Reauth is for a creator's connected social account.
 */
export function categoryForStatus(status: number | undefined): FailureCategory {
  if (status === undefined) return 'retriable';
  if (status === 429) return 'quota';
  if (status === 408 || status >= 500) return 'retriable';
  return 'terminal';
}

const ABORT_NAMES = new Set(['AbortError', 'TimeoutError', 'APIUserAbortError']);

function statusOf(err: unknown): number | undefined {
  const status = (err as { status?: unknown } | null)?.status;
  return typeof status === 'number' ? status : undefined;
}

function retryAfterMs(err: unknown): number | undefined {
  const headers = (err as { headers?: unknown } | null)?.headers;
  if (!(headers instanceof Headers)) return undefined;
  const seconds = Number(headers.get('retry-after'));
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : undefined;
}

/**
 * The adapter boundary (invariant 3). The raw provider error is logged here and goes no
 * further: callers get a normalised AdapterError whose message names only the provider and
 * the status, never the provider's own error text.
 */
export function normalizeError(
  provider: string,
  err: unknown,
  log?: Logger,
  signal?: AbortSignal,
): AdapterError {
  if (isAdapterError(err)) return err;

  // The request's own signal is the reliable test: SDKs name their abort errors differently,
  // and the Anthropic SDK's surfaces as a plain `Error`.
  if (signal?.aborted || (err instanceof Error && ABORT_NAMES.has(err.name))) {
    return new AdapterError({
      code: 'ABORTED',
      message: `${provider} request was cancelled or timed out`,
      category: 'retriable',
    });
  }

  const status = statusOf(err);
  const retry = retryAfterMs(err);
  log?.warn({ provider, status, err }, 'provider call failed');
  return new AdapterError({
    code: status === undefined ? 'NETWORK' : `HTTP_${status}`,
    message: `${provider} request failed${status === undefined ? '' : ` with HTTP ${status}`}`,
    category: categoryForStatus(status),
    ...(retry === undefined ? {} : { retryAfterMs: retry }),
  });
}
