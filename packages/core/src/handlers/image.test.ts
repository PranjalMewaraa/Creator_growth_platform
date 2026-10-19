import { createFakeModeration, createImageAdapters, createMemoryStore } from '@cgp/adapters';
import { createLogger } from '@cgp/config';
import {
  AdapterError,
  type ImageAdapter,
  type ImageCapability,
  type ModerationAdapter,
  type QueuedJobData,
} from '@cgp/contracts';
import { costTelemetry, creditLedger, jobs, outputs, scoped, type Database } from '@cgp/db';
import {
  addTestProfile,
  createTestDatabase,
  createTestWorkspace,
  insertMeteringRates,
  seedTestCatalog,
} from '@cgp/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { findJob, startGeneration } from '../generate';
import { generators } from '../generators/definitions';
import { processJob } from '../process';
import type { Queues } from '../queues';
import { jobOutputs } from '../studio';
import { createImageHandlers } from './image';

const log = createLogger({ service: 'test', level: 'silent' });

/** Records what would be enqueued, so these tests need no Redis. */
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

afterAll(async () => {
  await db.close();
});

const intent = { intentText: 'A cold brew bottle on a Jaipur balcony' };

function deps() {
  return {
    db,
    queues: recordingQueues(),
    log,
    registry: generators,
    compile: { rewriters: [] },
    moderation: createFakeModeration(),
  };
}

function handlersWith(
  adapters: Record<string, ImageAdapter>,
  moderation: ModerationAdapter = createFakeModeration(),
  costInr = () => 0,
  capabilityOf?: (adapterKey: string) => ImageCapability | undefined,
) {
  return createImageHandlers({
    db,
    registry: generators,
    adapters,
    moderation,
    store,
    costInr,
    providerLabel: 'fake',
    capabilityOf,
  });
}

async function workspace(credits = 100) {
  const id = await createTestWorkspace(db, { credits });
  await addTestProfile(db, id);
  return id;
}

async function run(generatorKey: string, input: Record<string, unknown>, handlers = fakeHandlers) {
  const workspaceId = await workspace();
  const started = await startGeneration(deps(), { workspaceId, generatorKey, input });
  if (!started.ok) throw new Error(started.reason);
  const result = await processJob({ db, handlers, log }, {
    jobId: started.job.id,
    correlationId: started.job.id,
  } satisfies QueuedJobData);
  return { workspaceId, started, result };
}

let fakeHandlers: ReturnType<typeof createImageHandlers>;
beforeAll(() => {
  fakeHandlers = handlersWith(createImageAdapters('fake'));
});

describe('image generation end to end', () => {
  it('has a handler for each image generator only', () => {
    expect(Object.keys(fakeHandlers).sort()).toEqual(['image', 'thumbnail_set']);
  });

  it('stores one picture per image, framed for the platform it is for', async () => {
    const { workspaceId, started, result } = await run('image', {
      ...intent,
      targetPlatform: 'instagram',
      count: 2,
    });
    expect(result).toBe('settled');

    // 15 credits each, from the rates in force.
    const job = await findJob(db, workspaceId, started.job.id);
    expect(job).toMatchObject({ status: 'COMPLETE', settled: { credits: 30 } });

    const rows = await scoped(db, workspaceId).select(outputs);
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.storageKey).sort()).toEqual([
      `${workspaceId}/generated/${started.job.id}/0.png`,
      `${workspaceId}/generated/${started.job.id}/1.png`,
    ]);
    for (const row of rows) {
      expect(row).toMatchObject({ kind: 'image', compiledPromptId: started.prompt.id });
      // Instagram's frame, resolved by the compiler: the user never asked for 4:5.
      expect(row.metadata).toMatchObject({
        aspectRatio: '4:5',
        width: 256,
        height: 320,
        mimeType: 'image/png',
        adapter: 'gemini-flash-lite-image',
      });
      await expect(store.get(row.storageKey)).resolves.toBeInstanceOf(Uint8Array);
    }

    // The Studio sees them as media, not as text.
    const studio = await jobOutputs(db, workspaceId, started.job.id, store);
    expect(studio[0]?.media).toMatchObject({ width: 256, height: 320 });
    expect(studio[0]?.text).toBe('');

    const [telemetry] = await scoped(db, workspaceId).select(costTelemetry);
    expect(telemetry).toMatchObject({
      actionClass: 'image',
      provider: 'fake:gemini-flash-lite-image',
    });
  });

  it('always draws three thumbnails, whatever the input says', async () => {
    const { workspaceId, started } = await run('thumbnail_set', {
      ...intent,
      targetPlatform: 'linkedin',
      count: 1,
    });
    const rows = await scoped(db, workspaceId).select(outputs);
    expect(rows).toHaveLength(3);
    expect(rows.every((row) => row.kind === 'thumbnail')).toBe(true);
    // LinkedIn thumbnails are wide, again from the platform rather than the user.
    expect(rows[0]?.metadata).toMatchObject({ aspectRatio: '16:9', width: 320, height: 180 });
    expect(await findJob(db, workspaceId, started.job.id)).toMatchObject({
      settled: { credits: 36 },
    });
  });

  it('squares an image with no platform, since nothing decided a frame', async () => {
    const { workspaceId } = await run('image', { ...intent, targetPlatform: null });
    const [row] = await scoped(db, workspaceId).select(outputs);
    expect(row?.metadata).toMatchObject({ aspectRatio: '1:1', width: 256, height: 256 });
  });

  it('refunds in full, as blocked, when the model refuses to draw it', async () => {
    const refusing: ImageAdapter = {
      key: 'gemini-flash-lite-image',
      generate: () =>
        Promise.reject(
          new AdapterError({
            code: 'SAFETY_BLOCKED',
            message: 'refused',
            category: 'terminal',
          }),
        ),
    };
    const { workspaceId, started, result } = await run(
      'image',
      { ...intent, targetPlatform: 'instagram' },
      handlersWith({ 'gemini-flash-lite-image': refusing }),
    );
    expect(result).toBe('refunded');
    expect(await findJob(db, workspaceId, started.job.id)).toMatchObject({ status: 'BLOCKED' });
    expect(await scoped(db, workspaceId).select(outputs)).toEqual([]);
    const ledger = await scoped(db, workspaceId).select(creditLedger);
    expect(ledger.map((entry) => [entry.reason, entry.delta])).toEqual([
      ['grant', 100],
      ['hold', -15],
      ['refund', 15],
    ]);
  });

  it('settles a redelivered job without drawing again', async () => {
    const workspaceId = await workspace();
    const started = await startGeneration(deps(), {
      workspaceId,
      generatorKey: 'image',
      input: { ...intent, targetPlatform: 'instagram' },
    });
    if (!started.ok) throw new Error(started.reason);
    const [job] = await scoped(db, workspaceId).select(jobs);
    if (!job) throw new Error('no job');

    const handler = fakeHandlers.image;
    if (!handler) throw new Error('no handler');
    await handler(job, log);
    const again = await handler(job, log);
    expect(again.telemetry.realisedCostInr).toBe(0);
    expect(await scoped(db, workspaceId).select(outputs)).toHaveLength(1);
  });
});

describe('reference image (WP60)', () => {
  /** An image adapter that remembers what references it was given. */
  function watchingAdapter() {
    const seen: Array<{ references: number }> = [];
    const adapter: ImageAdapter = {
      key: 'gemini-flash-lite-image',
      generate: (request) => {
        seen.push({ references: request.references?.length ?? 0 });
        return Promise.resolve({
          images: [{ data: new Uint8Array([1]), mimeType: 'image/png', width: 1, height: 1 }],
          usage: { inputTokens: 0, outputTokens: 0 },
        });
      },
    };
    return { adapter, seen };
  }

  async function runWithReferences(
    keyCount: number,
    capability: { acceptsReferenceImages: boolean; maxReferenceImages: number },
  ): Promise<Array<{ references: number }>> {
    const { adapter, seen } = watchingAdapter();
    const workspaceId = await workspace();
    const keys = await Promise.all(
      Array.from({ length: keyCount }, async (_, i) => {
        const key = `${workspaceId}/references/test-${i}.png`;
        await store.put(key, new Uint8Array([1, 2, 3]), 'image/png');
        return key;
      }),
    );

    const started = await startGeneration(deps(), {
      workspaceId,
      generatorKey: 'image',
      input: { ...intent, referenceImageKeys: keys },
    });
    if (!started.ok) throw new Error(started.reason);
    await processJob(
      {
        db,
        handlers: handlersWith(
          { 'gemini-flash-lite-image': adapter },
          undefined,
          undefined,
          () => capability as ImageCapability,
        ),
        log,
      },
      { jobId: started.job.id, correlationId: started.job.id } satisfies QueuedJobData,
    );
    return seen;
  }

  it('sends an uploaded reference to a model whose capability accepts one', async () => {
    expect(
      await runWithReferences(1, { acceptsReferenceImages: true, maxReferenceImages: 3 }),
    ).toEqual([{ references: 1 }]);
  });

  it('never sends a reference to a model whose capability does not accept one', async () => {
    expect(
      await runWithReferences(1, { acceptsReferenceImages: false, maxReferenceImages: 3 }),
    ).toEqual([{ references: 0 }]);
  });

  it('sends more than one reference, up to the schema cap of three (WP63)', async () => {
    expect(
      await runWithReferences(3, { acceptsReferenceImages: true, maxReferenceImages: 3 }),
    ).toEqual([{ references: 3 }]);
  });

  it('trims to what the model allows, not what was uploaded', async () => {
    expect(
      await runWithReferences(3, { acceptsReferenceImages: true, maxReferenceImages: 1 }),
    ).toEqual([{ references: 1 }]);
  });
});

describe('model choice (WP63)', () => {
  function fakeAdapter(key: string): ImageAdapter {
    return {
      key,
      generate: () =>
        Promise.resolve({
          images: [{ data: new Uint8Array([1]), mimeType: 'image/png', width: 1, height: 1 }],
          usage: { inputTokens: 0, outputTokens: 0 },
        }),
    };
  }

  it('uses the model the request asked for', async () => {
    const workspaceId = await workspace();
    const started = await startGeneration(deps(), {
      workspaceId,
      generatorKey: 'image',
      input: { ...intent, imageModel: 'gemini-nano-banana-2-1' },
    });
    if (!started.ok) throw new Error(started.reason);
    await processJob(
      {
        db,
        handlers: handlersWith({
          'gemini-flash-lite-image': fakeAdapter('gemini-flash-lite-image'),
          'gemini-nano-banana-2-1': fakeAdapter('gemini-nano-banana-2-1'),
        }),
        log,
      },
      { jobId: started.job.id, correlationId: started.job.id } satisfies QueuedJobData,
    );
    const [output] = await scoped(db, workspaceId).select(outputs);
    expect(output?.metadata).toMatchObject({ adapter: 'gemini-nano-banana-2-1' });
  });

  it('falls back to the default model when none was asked for', async () => {
    const workspaceId = await workspace();
    const started = await startGeneration(deps(), {
      workspaceId,
      generatorKey: 'image',
      input: intent,
    });
    if (!started.ok) throw new Error(started.reason);
    await processJob(
      {
        db,
        handlers: handlersWith({
          'gemini-flash-lite-image': fakeAdapter('gemini-flash-lite-image'),
          'gemini-nano-banana-2-1': fakeAdapter('gemini-nano-banana-2-1'),
        }),
        log,
      },
      { jobId: started.job.id, correlationId: started.job.id } satisfies QueuedJobData,
    );
    const [output] = await scoped(db, workspaceId).select(outputs);
    expect(output?.metadata).toMatchObject({ adapter: 'gemini-flash-lite-image' });
  });
});
