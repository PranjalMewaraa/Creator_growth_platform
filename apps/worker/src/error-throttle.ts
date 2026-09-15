import type { Logger } from '@cgp/config';

/**
 * A dropped Redis connection makes every client retry and emit an error several times a
 * second. Logs the first error of each kind, then at most once per window with a count of
 * what was suppressed, so a real failure is not buried under reconnect noise.
 */
export function createErrorThrottle(
  log: Logger,
  { windowMs = 10_000, now = Date.now }: { windowMs?: number; now?: () => number } = {},
) {
  const seen = new Map<string, { at: number; suppressed: number }>();

  return (source: string, err: unknown, fields: Record<string, unknown> = {}) => {
    const { code, message } = err as { code?: string; message?: string };
    const key = `${source}:${code ?? message ?? 'unknown'}`;
    const entry = seen.get(key);
    const at = now();
    if (entry && at - entry.at < windowMs) {
      entry.suppressed += 1;
      return;
    }
    log.error({ source, ...fields, err, suppressed: entry?.suppressed ?? 0 }, `${source} error`);
    seen.set(key, { at, suppressed: 0 });
  };
}
