import { ingestTrends, type TrendIngestionDeps } from './trends';

/**
 * The trend ingestion ticker (WP61), in the same shape as the job dispatcher
 * (packages/core/src/scheduler.ts): a plain, non-overlapping `setTimeout` recursion rather
 * than a cron library, since this codebase already has one periodic-tick pattern and a second
 * one in a different shape would just be two things to remember instead of one.
 *
 * Unlike the dispatcher, the first tick runs immediately rather than after the first interval:
 * the dispatcher is covering jobs that might already be due the moment it starts, so waiting
 * one tick costs nothing; an empty trend radar on a fresh boot is a worse first impression than
 * one real ingestion pass costs in YouTube/Reddit quota.
 */
export function startTrendIngestion(
  deps: TrendIngestionDeps & { niches: string[]; region?: string },
  { everyMs }: { everyMs: number },
): () => void {
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;

  const tick = async () => {
    if (stopped) return;
    try {
      const results = await ingestTrends(deps, deps.niches, deps.region);
      const written = results.reduce((sum, r) => sum + r.trendsWritten, 0);
      deps.log.info({ niches: deps.niches.length, written }, 'trend ingestion tick done');
    } catch (err) {
      deps.log.error({ err }, 'trend ingestion tick failed');
    }
    if (!stopped) timer = setTimeout(() => void tick(), everyMs);
  };

  void tick();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}
