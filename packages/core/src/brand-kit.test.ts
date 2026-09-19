import { createFakeModeration, createMemoryStore } from '@cgp/adapters';
import { createLogger } from '@cgp/config';
import type { Database } from '@cgp/db';
import { createTestDatabase, createTestWorkspace, seedTestCatalog } from '@cgp/db/testing';
import { compile } from '@cgp/orchestration';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { brandKitHistory, saveBrandKit, storeLogo, type BrandKitInput } from './brand-kit';
import { saveProfile } from './profile';

const log = createLogger({ service: 'test', level: 'silent' });
let db: Database;

beforeAll(async () => {
  db = await createTestDatabase();
  await seedTestCatalog(db);
});

afterAll(async () => {
  await db.close();
});

const kit: BrandKitInput = {
  logoUrl: null,
  colors: ['#1F2937', '#F59E0B'],
  typography: 'Poppins',
  tagline: 'Made in small batches',
};

async function workspaceWithProfile() {
  const workspaceId = await createTestWorkspace(db);
  await saveProfile(db, workspaceId, {
    contentTypes: ['Short video'],
    platforms: ['instagram'],
    teamShape: 'Solo creator',
    goal90d: 'Grow',
    cadence: '3 posts a week',
    pillars: ['How to'],
    tone: 'Warm',
    prohibitedWords: [],
    language: 'en',
  });
  return workspaceId;
}

describe('saveBrandKit', () => {
  it('saves N+1 and the next compile uses the new kit (WP13)', async () => {
    const workspaceId = await workspaceWithProfile();
    const store = createMemoryStore();

    expect(await saveBrandKit({ db, store }, workspaceId, kit)).toEqual({
      ok: true,
      version: 1,
      changed: true,
    });
    expect(
      await saveBrandKit({ db, store }, workspaceId, {
        ...kit,
        colors: ['#e11d48'],
        tagline: 'Brewed slow',
      }),
    ).toEqual({ ok: true, version: 2, changed: true });

    const compiled = await compile(
      { db, rewriters: [] },
      {
        workspaceId,
        outputType: 'image',
        intentText: 'A cold brew bottle',
        targetPlatform: 'instagram',
        params: { count: 1 },
      },
    );
    if (!compiled.ok) throw new Error(compiled.reason);
    expect(compiled.prompt.lineage.brandKitVersion).toBe(2);
    expect(compiled.prompt.text).toContain('Lean on the brand colours #E11D48.');
  });

  it('makes no version when nothing changed, whatever the colour case', async () => {
    const workspaceId = await workspaceWithProfile();
    const store = createMemoryStore();
    await saveBrandKit({ db, store }, workspaceId, kit);
    expect(
      await saveBrandKit({ db, store }, workspaceId, { ...kit, colors: ['#1f2937', '#f59e0b'] }),
    ).toEqual({ ok: true, version: 1, changed: false });
  });

  it('refuses bad colours and a logo this workspace did not upload', async () => {
    const workspaceId = await workspaceWithProfile();
    const store = createMemoryStore();
    const result = await saveBrandKit({ db, store }, workspaceId, {
      ...kit,
      colors: ['red'],
    });
    expect(result).toMatchObject({ ok: false, issues: [{ path: 'colors.0' }] });

    const foreign = await saveBrandKit({ db, store }, workspaceId, {
      ...kit,
      logoUrl: 'https://example.com/logo.png',
    });
    expect(foreign).toMatchObject({ ok: false, issues: [{ path: 'logoUrl' }] });
  });

  it('lists the history with what each version changed', async () => {
    const workspaceId = await workspaceWithProfile();
    const store = createMemoryStore();
    await saveBrandKit({ db, store }, workspaceId, kit);
    await saveBrandKit({ db, store }, workspaceId, { ...kit, tagline: 'New line' });
    const history = await brandKitHistory(db, workspaceId);
    expect(history.map((v) => [v.version, v.changes])).toEqual([
      [2, ['Tagline']],
      [1, ['First version']],
    ]);
  });
});

describe('storeLogo', () => {
  it('stores a PNG under the workspace brand prefix, at most 512px, and the kit accepts it', async () => {
    const workspaceId = await workspaceWithProfile();
    const store = createMemoryStore();
    const big = await sharp({
      create: { width: 1600, height: 800, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .png()
      .toBuffer();

    const logo = await storeLogo(
      { store, moderation: createFakeModeration(), log },
      workspaceId,
      new Uint8Array(big),
    );
    if (!logo.ok) throw new Error(logo.reason);
    expect(logo.url).toContain(`${workspaceId}/brand/logo-`);
    const key = logo.url.replace('https://fake-storage.invalid/', '');
    expect(await sharp(await store.get(key)).metadata()).toMatchObject({
      format: 'png',
      width: 512,
      height: 256,
      hasAlpha: true,
    });

    expect(
      await saveBrandKit({ db, store }, workspaceId, { ...kit, logoUrl: logo.url }),
    ).toMatchObject({ ok: true, changed: true });
  });

  it('refuses SVG and anything else that is not PNG or JPEG', async () => {
    const result = await storeLogo(
      { store: createMemoryStore(), moderation: createFakeModeration(), log },
      'ws',
      new TextEncoder().encode('<svg onload="alert(1)"></svg>'),
    );
    expect(result).toMatchObject({ ok: false, reason: 'invalid_input' });
  });
});
