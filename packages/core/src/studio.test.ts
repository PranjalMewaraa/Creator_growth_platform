import { createFakeModeration, createImageAdapters, createMemoryStore } from '@cgp/adapters';
import { createLogger } from '@cgp/config';
import type { QueuedJobData } from '@cgp/contracts';
import { type Database } from '@cgp/db';
import {
  addTestProfile,
  createTestDatabase,
  createTestWorkspace,
  insertMeteringRates,
  seedTestCatalog,
} from '@cgp/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startGeneration } from './generate';
import { generators } from './generators/definitions';
import { createImageHandlers } from './handlers/image';
import { processJob } from './process';
import { recentOutputsFeed } from './studio';
import type { Queues } from './queues';

const log = createLogger({ service: 'test', level: 'silent' });

function recordingQueues(): Queues {
  const queue = () => ({ add: () => Promise.resolve() });
  return { inference: queue(), render: queue(), publish: queue() } as unknown as Queues;
}

let db: Database;
let store: ReturnType<typeof createMemoryStore>;

beforeAll(async () => {
  db = await createTestDatabase();
  await insertMeteringRates(db);
  await seedTestCatalog(db);
  store = createMemoryStore();
});

afterAll(() => db.close());

async function makeImage(workspaceId: string, intentText: string) {
  const started = await startGeneration(
    {
      db,
      queues: recordingQueues(),
      log,
      registry: generators,
      compile: { rewriters: [] },
      moderation: createFakeModeration(),
    },
    { workspaceId, generatorKey: 'image', input: { intentText, targetPlatform: 'instagram' } },
  );
  if (!started.ok) throw new Error(started.reason);
  const handlers = createImageHandlers({
    db,
    registry: generators,
    adapters: createImageAdapters('fake'),
    moderation: createFakeModeration(),
    store,
    costInr: () => 0,
    providerLabel: 'fake',
  });
  await processJob(
    { db, handlers, log },
    { jobId: started.job.id, correlationId: started.job.id } satisfies QueuedJobData,
  );
  return started.job.id;
}

describe('recentOutputsFeed (WP64)', () => {
  it('is empty for a workspace with nothing generated yet', async () => {
    const workspaceId = await createTestWorkspace(db, { credits: 100 });
    await addTestProfile(db, workspaceId);
    expect(await recentOutputsFeed(db, workspaceId)).toEqual([]);
  });

  it('lists every output across every job, newest first, with the job\'s own intent', async () => {
    const workspaceId = await createTestWorkspace(db, { credits: 100 });
    await addTestProfile(db, workspaceId);
    await makeImage(workspaceId, 'A cold brew bottle on a Jaipur balcony');
    await makeImage(workspaceId, 'A roastery at golden hour');

    const feed = await recentOutputsFeed(db, workspaceId);
    expect(feed).toHaveLength(2);
    expect(feed.map((row) => row.intentText)).toEqual([
      'A roastery at golden hour',
      'A cold brew bottle on a Jaipur balcony',
    ]);
    expect(feed[0]).toMatchObject({ kind: 'image', generatorKey: 'image' });
    expect(feed[0]?.media?.url).toBeTruthy();
  });

  it('paginates with a before cursor, never repeating or skipping a row', async () => {
    const workspaceId = await createTestWorkspace(db, { credits: 100 });
    await addTestProfile(db, workspaceId);
    await makeImage(workspaceId, 'first');
    await makeImage(workspaceId, 'second');
    await makeImage(workspaceId, 'third');

    const page1 = await recentOutputsFeed(db, workspaceId, { limit: 2 });
    expect(page1.map((r) => r.intentText)).toEqual(['third', 'second']);

    const page2 = await recentOutputsFeed(db, workspaceId, {
      limit: 2,
      before: page1[page1.length - 1]!.createdAt,
    });
    expect(page2.map((r) => r.intentText)).toEqual(['first']);
  });
});
