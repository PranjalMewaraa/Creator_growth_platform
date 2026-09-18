import { brandKits, scoped, type Database } from '@cgp/db';
import { createTestDatabase, createTestWorkspace, seedTestCatalog } from '@cgp/db/testing';
import { compile } from '@cgp/orchestration';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { profileHistory, saveProfile, type ProfileInput } from './profile';

let db: Database;

beforeAll(async () => {
  db = await createTestDatabase();
  await seedTestCatalog(db);
});

afterAll(async () => {
  await db.close();
});

const answers: ProfileInput = {
  contentTypes: ['Short video', 'Carousel'],
  platforms: ['instagram'],
  teamShape: 'Solo creator',
  goal90d: 'Reach 10k followers',
  cadence: '3 posts a week',
  pillars: ['How to', 'Behind the scenes'],
  tone: 'Warm, direct, practical',
  prohibitedWords: [],
  language: 'en',
};

describe('saveProfile', () => {
  it('saves version 1, then N+1 on each correction, and the next compile uses it (WP12)', async () => {
    const workspaceId = await createTestWorkspace(db);
    await scoped(db, workspaceId).insert(brandKits, { version: 1, colors: ['#111111'] });

    const first = await saveProfile(db, workspaceId, answers);
    expect(first).toMatchObject({ ok: true, changed: true, profile: { version: 1 } });

    const second = await saveProfile(db, workspaceId, { ...answers, tone: 'Playful and witty' });
    expect(second).toMatchObject({ ok: true, changed: true, profile: { version: 2 } });

    const compiled = await compile(
      { db, rewriters: [] },
      {
        workspaceId,
        outputType: 'caption',
        intentText: 'New batch is ready',
        targetPlatform: 'instagram',
        params: {},
      },
    );
    if (!compiled.ok) throw new Error(compiled.reason);
    expect(compiled.prompt.lineage.profileVersion).toBe(2);
    expect(compiled.prompt.text).toContain('Tone: Playful and witty.');
  });

  it('makes no version when nothing changed', async () => {
    const workspaceId = await createTestWorkspace(db);
    await saveProfile(db, workspaceId, answers);
    const again = await saveProfile(db, workspaceId, {
      ...answers,
      pillars: ['How to', 'How to', 'Behind the scenes'],
    });
    expect(again).toMatchObject({ ok: true, changed: false, profile: { version: 1 } });
  });

  it('refuses a profile missing what the compiler needs', async () => {
    const workspaceId = await createTestWorkspace(db);
    const result = await saveProfile(db, workspaceId, { ...answers, platforms: [], pillars: [] });
    expect(result).toMatchObject({ ok: false, reason: 'invalid_input' });
    if (result.ok) return;
    expect(result.issues.map((i) => i.path).sort()).toEqual(['pillars', 'platforms']);
  });

  it('numbers concurrent saves without a gap or a clash', async () => {
    const workspaceId = await createTestWorkspace(db);
    const saves = await Promise.all(
      ['A', 'B', 'C'].map((goal) => saveProfile(db, workspaceId, { ...answers, goal90d: goal })),
    );
    const versions = saves.map((s) => (s.ok ? s.profile.version : 0)).sort();
    expect(versions).toEqual([1, 2, 3]);
  });
});

describe('profileHistory', () => {
  it('lists versions newest first with what each one changed', async () => {
    const workspaceId = await createTestWorkspace(db);
    await saveProfile(db, workspaceId, answers);
    await saveProfile(db, workspaceId, { ...answers, cadence: 'Every day', tone: 'Bold' });

    const history = await profileHistory(db, workspaceId);
    expect(history.map((v) => [v.version, v.changes])).toEqual([
      [2, ['Cadence', 'Tone']],
      [1, ['First version']],
    ]);
    expect(history[0]?.profile.cadence).toBe('Every day');
  });
});
