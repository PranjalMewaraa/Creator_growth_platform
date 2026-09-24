import { createFakeModeration, createImageAdapters, createMemoryStore } from '@cgp/adapters';
import { createLogger } from '@cgp/config';
import type { TextLayerSpec } from '@cgp/contracts';
import { findRendition, outputs, scoped, type Database } from '@cgp/db';
import {
  addTestProfile,
  createTestDatabase,
  createTestWorkspace,
  insertMeteringRates,
  seedTestCatalog,
} from '@cgp/db/testing';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startGeneration } from './generate';
import { generators } from './generators/definitions';
import { createImageHandlers } from './handlers/image';
import { processJob } from './process';
import type { Queues } from './queues';
import { jobOutputs } from './studio';
import { saveTextLayer } from './text-layer';

const log = createLogger({ service: 'test', level: 'silent' });

function recordingQueues(): Queues {
  const queue = () => ({ add: () => Promise.resolve() });
  return { inference: queue(), render: queue(), publish: queue() } as unknown as Queues;
}

const spec: TextLayerSpec = {
  version: 1,
  blocks: [
    {
      text: 'Cold brew, now in Jaipur',
      x: 0.08,
      y: 0.7,
      width: 0.84,
      fontSize: 0.08,
      font: 'Poppins',
      bold: true,
      colour: '#FACC15',
      align: 'left',
      plate: null,
    },
  ],
};

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

/** A workspace with one finished picture in it, which is what a layer is drawn on. */
async function pictureOutput(targetPlatform: string | null = 'instagram') {
  const workspaceId = await createTestWorkspace(db, { credits: 100 });
  await addTestProfile(db, workspaceId);
  const started = await startGeneration(
    {
      db,
      queues: recordingQueues(),
      log,
      registry: generators,
      compile: { rewriters: [] },
      moderation: createFakeModeration(),
    },
    {
      workspaceId,
      generatorKey: 'image',
      input: { intentText: 'A cold brew bottle on a balcony', targetPlatform },
    },
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
  await processJob({ db, handlers, log }, { jobId: started.job.id, correlationId: 'c' });
  const [output] = await scoped(db, workspaceId).select(outputs);
  if (!output) throw new Error('no output');
  return { workspaceId, jobId: started.job.id, outputId: output.id };
}

describe('saveTextLayer', () => {
  it('flattens the layer, stores it and keeps the picture underneath untouched', async () => {
    const { workspaceId, outputId } = await pictureOutput();
    const [row] = await scoped(db, workspaceId).select(outputs);
    const before = await store.get(row?.storageKey ?? '');

    const result = await saveTextLayer({ db, store }, workspaceId, outputId, spec);
    if (!result.ok) throw new Error(result.reason);
    expect(result.rendition.url).toContain(`${workspaceId}/renditions/${outputId}.instagram.jpg`);

    const flattened = await store.get(`${workspaceId}/renditions/${outputId}.instagram.jpg`);
    expect(await sharp(flattened).metadata()).toMatchObject({ format: 'jpeg' });
    // The original is byte for byte what the model drew.
    expect(Buffer.from(await store.get(row?.storageKey ?? '')).equals(Buffer.from(before))).toBe(
      true,
    );
  });

  it('replaces the layer rather than piling up renditions', async () => {
    const { workspaceId, outputId } = await pictureOutput();
    await saveTextLayer({ db, store }, workspaceId, outputId, spec);
    const second: TextLayerSpec = {
      version: 1,
      blocks: [{ ...spec.blocks[0]!, text: 'Something else entirely' }],
    };
    const again = await saveTextLayer({ db, store }, workspaceId, outputId, second);
    if (!again.ok) throw new Error(again.reason);

    const saved = await findRendition(db, workspaceId, outputId, 'instagram');
    expect((saved?.spec as TextLayerSpec).blocks[0]?.text).toBe('Something else entirely');
  });

  it('files the rendition under the platform the picture was framed for', async () => {
    const { workspaceId, outputId } = await pictureOutput('linkedin');
    await saveTextLayer({ db, store }, workspaceId, outputId, spec);
    expect(await findRendition(db, workspaceId, outputId, 'linkedin')).toBeDefined();
    expect(await findRendition(db, workspaceId, outputId, 'instagram')).toBeUndefined();
  });

  it('shows the layer with the output, so the editor reopens on it', async () => {
    const { workspaceId, jobId, outputId } = await pictureOutput();
    await saveTextLayer({ db, store }, workspaceId, outputId, spec);
    const [output] = await jobOutputs(db, workspaceId, jobId, store);
    expect(output?.rendition?.spec.blocks[0]?.text).toBe('Cold brew, now in Jaipur');
    expect(output?.rendition?.url).toContain('renditions');
  });

  it('refuses a spec the schema will not have, saying what is wrong', async () => {
    const { workspaceId, outputId } = await pictureOutput();
    const result = await saveTextLayer({ db, store }, workspaceId, outputId, {
      version: 1,
      blocks: [{ ...spec.blocks[0]!, colour: 'yellow' }],
    });
    expect(result).toMatchObject({ ok: false, reason: 'invalid_input' });
    if (result.ok || result.reason !== 'invalid_input') throw new Error('expected issues');
    expect(result.issues[0]?.path).toBe('blocks.0.colour');
  });

  it('never draws on another workspace’s picture', async () => {
    const { outputId } = await pictureOutput();
    const other = await createTestWorkspace(db, { credits: 10 });
    expect(await saveTextLayer({ db, store }, other, outputId, spec)).toEqual({
      ok: false,
      reason: 'output_not_found',
    });
  });

  it('refuses an output that is not a picture', async () => {
    const { workspaceId } = await pictureOutput();
    expect(await saveTextLayer({ db, store }, workspaceId, 'not-a-uuid', spec)).toEqual({
      ok: false,
      reason: 'output_not_found',
    });
  });
});
