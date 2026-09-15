import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { MeteringRates } from './credits';
import { TARGET_PLATFORMS, type GeneratorDefinition, type TargetPlatform } from './generator';

// A definition shaped like a real one. Typechecking this file proves a zod schema satisfies
// `inputSchema` with its inferred type.
const captionSet: GeneratorDefinition<{ intent: string; platforms: TargetPlatform[] }> = {
  key: 'caption_set',
  outputType: 'caption',
  jobClass: 'inference',
  inputSchema: z.object({
    intent: z.string().min(1),
    platforms: z.array(z.enum(TARGET_PLATFORMS)).min(1),
  }),
  compilerProfile: 'caption',
  providerAdapter: 'text.flash-lite',
  estimate: (_input, rates) => {
    const credits = rates.credits.caption_set ?? 0;
    return { credits, breakdown: [{ label: 'Caption set', credits }] };
  },
};

describe('GeneratorDefinition', () => {
  it('prices from the rates passed in, so a rate change needs no deploy', () => {
    const input = captionSet.inputSchema.parse({ intent: 'Launch day', platforms: ['instagram'] });
    const v1: MeteringRates = { version: 1, credits: { caption_set: 1 } };
    const v2: MeteringRates = { version: 2, credits: { caption_set: 2 } };

    expect(captionSet.estimate(input, v1).credits).toBe(1);
    expect(captionSet.estimate(input, v2).credits).toBe(2);
  });

  it('rejects input the schema does not allow', () => {
    expect(() => captionSet.inputSchema.parse({ intent: '', platforms: ['x'] })).toThrow();
  });
});
