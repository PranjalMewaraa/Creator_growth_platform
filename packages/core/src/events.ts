import type { JobStage } from '@cgp/contracts';
import type { Redis } from 'ioredis';

// Streamed text travels over Redis pub/sub (D9): transport only, never the record. Status
// always comes from Postgres, and the finished text from the job's output.

export interface JobChannelOptions {
  /** Namespaces channels, as QueueOptions.prefix does for queues. */
  prefix?: string;
}

export function jobChannel(jobId: string, { prefix = 'cgp' }: JobChannelOptions = {}): string {
  return `${prefix}:job:${jobId}`;
}

/** Called by a handler as tokens arrive. Nobody listening is fine: the delta is simply dropped. */
export async function publishDelta(
  redis: Redis,
  jobId: string,
  text: string,
  options?: JobChannelOptions,
): Promise<void> {
  await redis.publish(jobChannel(jobId, options), JSON.stringify({ type: 'delta', text }));
}

/** The same channel, carrying a step of work rather than a token of text (WP44). */
export async function publishStage(
  redis: Redis,
  jobId: string,
  stage: JobStage,
  options?: JobChannelOptions,
): Promise<void> {
  await redis.publish(jobChannel(jobId, options), JSON.stringify({ type: 'stage', stage }));
}

/**
 * Listens for one job's deltas and stages on a connection of its own, since a subscribed
 * connection can do nothing else. Returns a function that unsubscribes and closes it.
 */
export async function subscribeDeltas(
  redis: Redis,
  jobId: string,
  onDelta: (text: string) => void,
  options?: JobChannelOptions,
  onStage?: (stage: JobStage) => void,
): Promise<() => Promise<void>> {
  const subscriber = redis.duplicate();
  const channel = jobChannel(jobId, options);
  subscriber.on('message', (from: string, message: string) => {
    if (from !== channel) return;
    const event = JSON.parse(message) as { type?: unknown; text?: unknown; stage?: unknown };
    if (event.type === 'delta' && typeof event.text === 'string') onDelta(event.text);
    if (event.type === 'stage' && event.stage) onStage?.(event.stage as JobStage);
  });
  await subscriber.subscribe(channel);
  return async () => {
    await subscriber.unsubscribe(channel).catch(() => undefined);
    subscriber.disconnect();
  };
}
