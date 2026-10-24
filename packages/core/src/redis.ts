import { Redis } from 'ioredis';

/**
 * BullMQ needs maxRetriesPerRequest: null so blocking commands wait out a Redis restart.
 *
 * enableReadyCheck: false is for Upstash specifically: ioredis's ready check runs INFO on
 * connect, and Upstash's managed Redis answers it with NOPERM rather than a result. ioredis
 * already logs "skipping the ready check" and moves on when that happens — but the NOPERM
 * reply is still surfaced as an `error` event on the connection, and with nothing listening
 * for it, Node treats an unhandled `error` event as fatal and crashes the process on the very
 * first connect. Turning the ready check off means INFO is never sent, so there is no reply to
 * fail on. Confirmed live against Upstash on 2026-10-22.
 */
export function createRedis(url: string): Redis {
  return new Redis(url, { maxRetriesPerRequest: null, enableReadyCheck: false });
}

/** Resolves once the connection is ready. ioredis keeps retrying in the background until then. */
export function waitForRedis(connection: Redis): Promise<void> {
  if (connection.status === 'ready') return Promise.resolve();
  return new Promise((resolve) => connection.once('ready', () => resolve()));
}
