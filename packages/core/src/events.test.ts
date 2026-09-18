import { randomUUID } from 'node:crypto';
import { loadRootEnvFile } from '@cgp/config';
import { Redis } from 'ioredis';
import { afterAll, describe, expect, it } from 'vitest';
import { publishDelta, subscribeDeltas } from './events';

// Needs a real Redis (REDIS_URL); skipped when none answers, as in CI.
loadRootEnvFile();
const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';
const redis = new Redis(redisUrl, {
  lazyConnect: true,
  connectTimeout: 1500,
  maxRetriesPerRequest: 0,
});
const redisUp = await redis
  .connect()
  .then(async () => (await redis.ping()) === 'PONG')
  .catch(() => false);

afterAll(() => {
  redis.disconnect();
});

describe.skipIf(!redisUp)('job deltas over pub/sub', () => {
  it('delivers deltas for one job only, in order, until unsubscribed', async () => {
    const prefix = `test-${randomUUID()}`;
    const received: string[] = [];
    const stop = await subscribeDeltas(redis, 'job-a', (t) => received.push(t), { prefix });

    await publishDelta(redis, 'job-b', 'other job', { prefix });
    await publishDelta(redis, 'job-a', 'Hello', { prefix });
    await publishDelta(redis, 'job-a', ' world', { prefix });
    await expect.poll(() => received.join('')).toBe('Hello world');

    await stop();
    await publishDelta(redis, 'job-a', '!', { prefix });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(received).toEqual(['Hello', ' world']);
  });
});
