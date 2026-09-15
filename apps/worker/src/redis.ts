import { Redis } from 'ioredis';

/** BullMQ needs maxRetriesPerRequest: null so blocking commands wait out a Redis restart. */
export function createRedis(url: string): Redis {
  return new Redis(url, { maxRetriesPerRequest: null });
}

/** Resolves once the connection is ready. ioredis keeps retrying in the background until then. */
export function waitForRedis(connection: Redis): Promise<void> {
  if (connection.status === 'ready') return Promise.resolve();
  return new Promise((resolve) => connection.once('ready', () => resolve()));
}
