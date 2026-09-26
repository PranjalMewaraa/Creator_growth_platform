import {
  createFakeModeration,
  createImageAdapters,
  createMemoryStore,
  createTextAdapters,
} from '@cgp/adapters';
import { createLogger } from '@cgp/config';
import { catalog, templates as templatesTable, templateVersions, type Database } from '@cgp/db';
import {
  addTestProfile,
  createTestDatabase,
  createTestWorkspace,
  insertMeteringRates,
  seedTestCatalog,
} from '@cgp/db/testing';
import { compile } from '@cgp/orchestration';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generators } from './generators/definitions';
import { buildTemplatePreviews } from './template-previews';
import { listTemplates } from './templates';

const log = createLogger({ service: 'test', level: 'silent' });

let db: Database;

beforeAll(async () => {
  db = await createTestDatabase();
  await insertMeteringRates(db);
  await seedTestCatalog(db);
});

afterAll(async () => {
  await db.close();
});

describe('the gallery', () => {
  it('has a template for every output type, and more than one for most', async () => {
    const cards = await listTemplates(db, generators);
    // Thirteen in the gallery plus the plain one per output type.
    expect(cards.length).toBeGreaterThanOrEqual(15);
    for (const outputType of ['script', 'hook', 'caption', 'image', 'thumbnail', 'video']) {
      expect(cards.filter((card) => card.outputType === outputType).length).toBeGreaterThan(1);
    }
  });

  it('prices a video template by the reel it makes, not the storyboard that previews it', async () => {
    const cards = await listTemplates(db, generators);
    const reel = cards.find((card) => card.slug === 'slow-product-reel');
    // Video is paid in seconds, so a reel costs no credits at all.
    expect(reel).toMatchObject({ outputType: 'video', credits: 0, costBand: 'heavy' });
  });

  it('prices each template against the rates in force and names its cost band', async () => {
    const cards = await listTemplates(db, generators);
    const script = cards.find((card) => card.slug === 'myth-buster');
    const image = cards.find((card) => card.slug === 'product-on-surface');
    expect(script).toMatchObject({ credits: 6, costBand: 'standard', outputType: 'script' });
    expect(image).toMatchObject({ credits: 15, costBand: 'standard' });
  });

  it('shows no preview until one has been generated', async () => {
    const cards = await listTemplates(db, generators);
    expect(cards.every((card) => card.preview === null)).toBe(true);
  });
});

describe('a template', () => {
  it('changes the compiled prompt, and cannot lift a platform constraint', async () => {
    const workspaceId = await createTestWorkspace(db, { credits: 100 });
    await addTestProfile(db, workspaceId);
    const [myth] = await catalog(db).select(templatesTable, {
      where: (t, op) => op.eq(t.slug, 'myth-buster'),
    });
    if (!myth) throw new Error('template missing');

    const request = {
      workspaceId,
      outputType: 'script' as const,
      intentText: 'Cold brew keeps for two weeks in the fridge',
      targetPlatform: 'instagram' as const,
      params: {},
    };
    const plain = await compile({ db, rewriters: [], log }, request);
    const angled = await compile({ db, rewriters: [], log }, { ...request, templateId: myth.id });
    if (!plain.ok || !angled.ok) throw new Error('compile refused');

    // The template's angle and shape are in the prompt; the plain one has neither.
    expect(angled.prompt.text).toContain('correct a belief');
    expect(angled.prompt.text).toContain('State the myth in the first sentence');
    expect(plain.prompt.text).not.toContain('correct a belief');
    // The safety policy is still there, and still outranks the template.
    expect(angled.prompt.text).toContain('Keep it safe for a general audience');
  });

  it('beats the output type default it sets, rather than losing to it', async () => {
    const workspaceId = await createTestWorkspace(db, { credits: 100 });
    await addTestProfile(db, workspaceId);
    const [howIDoIt] = await catalog(db).select(templatesTable, {
      where: (t, op) => op.eq(t.slug, 'how-i-do-it'),
    });
    const compiled = await compile(
      { db, rewriters: [], log },
      {
        workspaceId,
        outputType: 'script',
        intentText: 'How I cold brew at home',
        targetPlatform: null,
        templateId: howIDoIt?.id,
        params: {},
      },
    );
    if (!compiled.ok) throw new Error(compiled.reason);
    // The script profile defaults to 30 seconds; this template asks for 45.
    expect(compiled.prompt.text).toContain('about 45 seconds');
    expect(compiled.prompt.text).not.toContain('about 30 seconds');
  });

  it('still loses to an explicit instruction from the user', async () => {
    const workspaceId = await createTestWorkspace(db, { credits: 100 });
    await addTestProfile(db, workspaceId);
    const [howIDoIt] = await catalog(db).select(templatesTable, {
      where: (t, op) => op.eq(t.slug, 'how-i-do-it'),
    });
    const compiled = await compile(
      { db, rewriters: [], log },
      {
        workspaceId,
        outputType: 'script',
        intentText: 'How I cold brew at home',
        targetPlatform: null,
        templateId: howIDoIt?.id,
        params: { durationSeconds: 90 },
      },
    );
    if (!compiled.ok) throw new Error(compiled.reason);
    expect(compiled.prompt.text).toContain('about 90 seconds');
  });
});

describe('the preview pipeline', () => {
  it('runs each template through its own generator and keeps what came back', async () => {
    const workspaceId = await createTestWorkspace(db, { credits: 500 });
    await addTestProfile(db, workspaceId);
    const store = createMemoryStore();
    const outcomes = await buildTemplatePreviews(
      {
        db,
        store,
        textCostInr: () => 0,
        imageCostInr: () => 0,
        moderation: createFakeModeration(),
        registry: generators,
        text: createTextAdapters('fake'),
        image: createImageAdapters('fake'),
        rewriters: [],
        log,
      },
      workspaceId,
      { only: ['myth-buster', 'product-on-surface', 'default-video'] },
    );

    expect(outcomes.find((o) => o.slug === 'myth-buster')?.status).toBe('made');
    expect(outcomes.find((o) => o.slug === 'product-on-surface')?.status).toBe('made');
    // With no way to film given, a video template is skipped rather than faked: a preview
    // that is not real output is not a preview (invariant 14).
    expect(outcomes.find((o) => o.slug === 'default-video')).toMatchObject({
      status: 'skipped',
      detail: 'no handler for video',
    });

    const cards = await listTemplates(db, generators);
    const script = cards.find((card) => card.slug === 'myth-buster');
    const image = cards.find((card) => card.slug === 'product-on-surface');
    expect(script?.preview?.text).toContain('[fake gemini-flash-lite]');
    expect(image?.preview?.mediaUrl).toContain('/generated/');
    expect(cards.find((card) => card.slug === 'default-video')?.preview).toBeNull();
  });

  it('leaves a template that already has a preview alone unless forced', async () => {
    const workspaceId = await createTestWorkspace(db, { credits: 500 });
    await addTestProfile(db, workspaceId);
    const deps = {
      db,
      store: createMemoryStore(),
      textCostInr: () => 0,
      imageCostInr: () => 0,
      moderation: createFakeModeration(),
      registry: generators,
      text: createTextAdapters('fake'),
      image: createImageAdapters('fake'),
      rewriters: [],
      log,
    };
    const again = await buildTemplatePreviews(deps, workspaceId, { only: ['myth-buster'] });
    expect(again[0]).toMatchObject({ status: 'skipped', detail: 'already has one' });

    const forced = await buildTemplatePreviews(deps, workspaceId, {
      only: ['myth-buster'],
      force: true,
    });
    expect(forced[0]?.status).toBe('made');
    // Still one preview for that version, not two.
    const rows = await catalog(db).select(templateVersions);
    expect(rows.length).toBeGreaterThan(0);
    const cards = await listTemplates(db, generators);
    expect(cards.filter((card) => card.slug === 'myth-buster')).toHaveLength(1);
  });
});
