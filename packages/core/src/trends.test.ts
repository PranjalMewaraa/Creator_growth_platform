import { upsertTrend, type Database } from '@cgp/db';
import { createTestDatabase } from '@cgp/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { matchCaptionToTrends } from './trends';

let db: Database;

beforeAll(async () => {
  db = await createTestDatabase();
});

afterAll(() => db.close());

async function seed(overrides: Partial<Parameters<typeof upsertTrend>[1]> = {}) {
  return upsertTrend(db, {
    niche: 'fitness',
    region: 'global',
    topicTitle: 'Smart Ring Wearables',
    velocityScore: 80,
    lifecycleStage: 'rising',
    sourcePlatform: 'autocomplete',
    summary: 'Creators are swapping bulky wrist trackers for minimalist smart rings.',
    creativeAngles: { contrarian: 'a', howTo: 'b', predictive: 'c' },
    suggestedHooks: ['Why I ditched my fitness watch for a ring'],
    recommendedTags: { instagram: ['smartring'], tiktok: ['wearabletech'] },
    ...overrides,
  });
}

describe('matchCaptionToTrends (WP62)', () => {
  it('scores zero with no trends ingested', async () => {
    const fit = await matchCaptionToTrends(db, 'A caption about absolutely nothing relevant.');
    expect(fit).toEqual({ score: 0, matches: [], suggestedHashtags: [], suggestedKeywords: [] });
  });

  it('scores higher the more of the trend\'s own vocabulary the caption uses', async () => {
    await seed();
    const close = await matchCaptionToTrends(
      db,
      'Why I ditched my bulky wrist tracker for a minimalist smart ring wearable this year.',
    );
    const far = await matchCaptionToTrends(db, 'My morning coffee routine in five steps.');
    expect(close.score).toBeGreaterThan(0);
    expect(close.matches[0]?.topicTitle).toBe('Smart Ring Wearables');
    expect(far.score).toBe(0);
    expect(far.matches).toHaveLength(0);
  });

  it('never suggests a hashtag or keyword already in the caption', async () => {
    await seed({ niche: 'tech', topicTitle: 'Foldable Phone Revival' });
    const fit = await matchCaptionToTrends(
      db,
      'Foldable phones are back. #foldable already in my caption, wearable tech too.',
    );
    expect(fit.suggestedHashtags.every((t) => !t.toLowerCase().includes('#foldable'))).toBe(true);
  });

  it('weighs a faster-rising trend above a slower one with identical wording overlap', async () => {
    // Same topic, same vocabulary, different niche (so the dedupe key still differs) and
    // different velocity — isolates velocity as the only thing that can break the tie.
    await seed({ niche: 'ai', topicTitle: 'Agentic Coding Workflows', velocityScore: 30 });
    await seed({ niche: 'startups', topicTitle: 'Agentic Coding Workflows', velocityScore: 90 });
    const fit = await matchCaptionToTrends(db, 'A deep dive on agentic coding workflows today.');
    expect(fit.matches[0]?.niche).toBe('startups');
  });
});
