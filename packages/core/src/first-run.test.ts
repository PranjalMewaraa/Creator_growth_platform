import { randomBytes } from 'node:crypto';
import { encryptSecret } from '@cgp/config';
import { brandKits, scoped, upsertSocialAccount, type Database } from '@cgp/db';
import { createTestDatabase, createTestWorkspace, seedTestCatalog } from '@cgp/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { firstRun } from './first-run';
import { saveProfile, type ProfileInput } from './profile';

const kek = randomBytes(32);

let db: Database;
beforeAll(async () => {
  db = await createTestDatabase();
  await seedTestCatalog(db);
});
afterAll(async () => {
  await db.close();
});

const answers: ProfileInput = {
  contentTypes: ['Short video'],
  platforms: ['instagram'],
  teamShape: 'Solo creator',
  goal90d: 'Reach 10k followers',
  cadence: '3 posts a week',
  pillars: ['How to'],
  tone: 'Warm, direct, practical',
  prohibitedWords: [],
  language: 'en',
};

describe('firstRun', () => {
  it('starts with four things to do and offers the profile first', async () => {
    const workspaceId = await createTestWorkspace(db);
    const state = await firstRun(db, workspaceId);

    expect(state.done).toBe(0);
    expect(state.total).toBe(4);
    expect(state.complete).toBe(false);
    expect(state.next?.key).toBe('profile');
    expect(state.steps.map((step) => step.key)).toEqual([
      'profile',
      'brand',
      'account',
      'generate',
    ]);
  });

  it('is the only required step, because nothing generates without it', async () => {
    const workspaceId = await createTestWorkspace(db);
    const state = await firstRun(db, workspaceId);
    expect(state.steps.filter((step) => step.required).map((step) => step.key)).toEqual([
      'profile',
    ]);
  });

  it('every step says what is lost by leaving it', async () => {
    const workspaceId = await createTestWorkspace(db);
    const state = await firstRun(db, workspaceId);
    for (const step of state.steps) expect(step.breaks.length).toBeGreaterThan(20);
  });

  it('reads done from what was really saved, and moves on to the next', async () => {
    const workspaceId = await createTestWorkspace(db);
    await saveProfile(db, workspaceId, answers);

    const after = await firstRun(db, workspaceId);
    expect(after.done).toBe(1);
    expect(after.steps[0]?.done).toBe(true);
    expect(after.next?.key).toBe('brand');

    await scoped(db, workspaceId).insert(brandKits, { version: 1, colors: ['#111111'] });
    const later = await firstRun(db, workspaceId);
    expect(later.done).toBe(2);
    expect(later.next?.key).toBe('account');
  });

  it('counts a connected account, and stays incomplete until something has been made', async () => {
    const workspaceId = await createTestWorkspace(db);
    await upsertSocialAccount(db, {
      workspaceId,
      platform: 'linkedin',
      externalId: 'member-1',
      displayName: 'A Person',
      scopes: ['w_member_social'],
      tokenCiphertext: encryptSecret(kek, 'token'),
      tokenExpiresAt: null,
    });

    const state = await firstRun(db, workspaceId);
    expect(state.steps.find((step) => step.key === 'account')?.done).toBe(true);
    expect(state.complete).toBe(false);
    expect(state.next?.key).toBe('profile');
  });

  it('is scoped to its workspace: a neighbour’s setup is not yours (invariant 1)', async () => {
    const mine = await createTestWorkspace(db);
    const theirs = await createTestWorkspace(db);
    await saveProfile(db, theirs, answers);

    expect((await firstRun(db, mine)).done).toBe(0);
    expect((await firstRun(db, theirs)).done).toBe(1);
  });
});
