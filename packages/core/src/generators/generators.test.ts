import { OUTPUT_TYPES, type MeteringRates } from '@cgp/contracts';
import { TEXT_MODEL_KEYS } from '@cgp/adapters';
import { METERING_RATES_V1 } from '@cgp/db/testing';
import { describe, expect, it } from 'vitest';
import { generators } from './definitions';
import { createGeneratorRegistry, rateFor, register } from './registry';
import { z } from 'zod';

const intent = { intentText: 'Launch day for our new cold brew' };

/**
 * What a generator needs beyond the intent before it can be priced. The corrections (WP50)
 * take the thing they are correcting, because a redraw with no frame and a refilm with no
 * scene are not requests anyone can put a number on.
 */
const ALSO: Record<string, Record<string, unknown>> = {
  redraw_frame: {
    storyboardOutputId: '00000000-0000-4000-8000-000000000001',
    frameIndex: 0,
  },
  regenerate_scene: { sceneId: '00000000-0000-4000-8000-000000000002' },
  storyboard_assemble: { storyboardId: '00000000-0000-4000-8000-000000000003' },
};

describe('generator registry', () => {
  it('covers every output type', () => {
    expect(new Set(generators.list().map((g) => g.outputType))).toEqual(new Set(OUTPUT_TYPES));
  });

  it('prices every generator from the seeded rates', () => {
    for (const generator of generators.list()) {
      const prepared = generator.prepare(
        { ...intent, ...(ALSO[generator.key] ?? {}) },
        METERING_RATES_V1,
      );
      expect(prepared.ok, generator.key).toBe(true);
    }
  });

  it('points text generators at configured text models', () => {
    const textTypes = new Set(['script', 'hook', 'caption']);
    for (const generator of generators.list().filter((g) => textTypes.has(g.outputType))) {
      expect(TEXT_MODEL_KEYS).toContain(generator.providerAdapter);
    }
  });

  it('rejects duplicate and badly named keys', () => {
    const one = register({
      key: 'dup',
      outputType: 'caption',
      jobClass: 'inference',
      inputSchema: z.object({}),
      compilerProfile: 'caption',
      providerAdapter: 'gemini-flash-lite',
      estimate: () => ({ credits: 0, breakdown: [] }),
    });
    expect(() => createGeneratorRegistry([one, one])).toThrow(/registered twice/);
    expect(() => createGeneratorRegistry([{ ...one, key: 'Bad-Key' }])).toThrow(/snake case/);
  });

  it('refuses to price an action the rates do not list, rather than charging 0', () => {
    expect(() => rateFor({ version: 9, credits: {} }, 'script')).toThrow(/v9 have no rate/);
  });
});

describe('generator definitions', () => {
  const rates: MeteringRates = METERING_RATES_V1;

  it('reprices when the rates change, with no deploy', () => {
    const script = generators.get('script');
    const v2 = { version: 2, credits: { ...rates.credits, script: 8 } };
    const a = script?.prepare(intent, rates);
    const b = script?.prepare(intent, v2);
    expect(a?.ok && a.estimate.credits).toBe(6);
    expect(b?.ok && b.estimate.credits).toBe(8);
  });

  it('charges images per image', () => {
    const prepared = generators.get('image')?.prepare({ ...intent, count: 3 }, rates);
    expect(prepared?.ok && prepared.estimate.credits).toBe(45);
  });

  it('holds video in seconds, not credits', () => {
    // Held for the most beats the planner could choose for a 16s target (two, plus the one
    // extra a free-flowing plan is allowed), not the target itself (WP59).
    const prepared = generators
      .get('video')
      ?.prepare({ ...intent, targetDurationSeconds: 16 }, rates);
    expect(prepared?.ok && prepared.estimate).toMatchObject({ credits: 0, videoSeconds: 24 });
  });

  it('fills priced defaults and leaves unstated instructions absent', () => {
    const prepared = generators.get('caption_set')?.prepare(intent, rates);
    expect(prepared?.ok && prepared.input).toMatchObject({
      intentText: intent.intentText,
      targetPlatform: null,
    });
    expect(prepared?.ok && prepared.input).not.toHaveProperty('platforms');
    expect(generators.get('image')?.prepare(intent, rates)).toMatchObject({ input: { count: 1 } });
  });

  it('reports every problem with its path', () => {
    const prepared = generators
      .get('image')
      ?.prepare({ intentText: '  ', count: 9, targetPlatform: 'tiktok' }, rates);
    expect(prepared?.ok).toBe(false);
    if (prepared?.ok !== false) return;
    expect(prepared.issues.map((i) => i.path).sort()).toEqual([
      'count',
      'intentText',
      'targetPlatform',
    ]);
  });
});
