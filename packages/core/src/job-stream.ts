import { isTerminalStatus, type JobEvent, type JobView } from '@cgp/contracts';

export interface JobStreamSource {
  /** Reads the job from Postgres. Undefined once it is gone from this workspace. */
  read(): Promise<JobView | undefined>;
  /** Relays deltas until the returned function is called. */
  subscribe(onDelta: (text: string) => void): Promise<() => Promise<void>>;
}

export interface JobStreamOptions {
  /** How often status is re-read from Postgres. */
  pollMs?: number;
  /**
   * The stream closes after this long even if the job is still running. Serverless functions
   * have a maximum duration; the browser's EventSource reconnects on its own (plan section 5).
   */
  maxMs?: number;
}

const encoder = new TextEncoder();

function frame(event: JobEvent): Uint8Array {
  return encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
}

/**
 * A server sent events body for one job: the current status first, then deltas as they come
 * and a status event whenever Postgres shows a change, ending after a terminal status.
 */
export function jobEventStream(
  source: JobStreamSource,
  { pollMs = 1000, maxMs = 55_000 }: JobStreamOptions = {},
): ReadableStream<Uint8Array> {
  let stop: (() => Promise<void>) | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let closed = false;

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const started = Date.now();
      const close = async () => {
        if (closed) return;
        closed = true;
        clearTimeout(timer);
        await stop?.();
        controller.close();
      };
      const send = (event: JobEvent) => {
        if (!closed) controller.enqueue(frame(event));
      };

      // Tell EventSource how long to wait before reconnecting after a close.
      controller.enqueue(encoder.encode(`retry: ${pollMs}\n\n`));

      // Subscribe before the first read, so no delta falls between the two.
      stop = await source.subscribe((text) => send({ type: 'delta', text }));

      let last: string | undefined;
      const poll = async () => {
        try {
          const job = await source.read();
          if (!job) return await close();
          const key = `${job.status}:${job.updatedAt}`;
          if (key !== last) {
            last = key;
            send({ type: 'status', job });
          }
          if (isTerminalStatus(job.status) || Date.now() - started >= maxMs) return await close();
          timer = setTimeout(() => void poll(), pollMs);
        } catch (err) {
          closed = true;
          clearTimeout(timer);
          await stop?.();
          controller.error(err);
        }
      };
      await poll();
    },
    async cancel() {
      closed = true;
      clearTimeout(timer);
      await stop?.();
    },
  });
}
