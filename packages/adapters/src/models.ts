import { INR_PER_USD } from '@cgp/config';
import type { TokenUsage } from '@cgp/contracts';

// Model ids live here and nowhere else. Changing one needs a pricing check first (plan
// section 17): the rate card is keyed on these, and a new id can mean a new price.

export type TextProvider = 'gemini' | 'claude' | 'gpt-oss';

export interface TextModel {
  provider: TextProvider;
  model: string;
  /** Vertex location for the call. Gemini 3.x and Claude answer on `global` (D10). */
  location: string;
  /** USD per million tokens, from plan section 6. For cost telemetry, never for charging. */
  usdPerMillion: { input: number; output: number };
}

export const TEXT_MODELS = {
  /** Default compile provider and the cheap workhorse (plan section 6). */
  'gemini-flash-lite': {
    provider: 'gemini',
    model: 'gemini-3.1-flash-lite',
    location: 'global',
    usdPerMillion: { input: 0.25, output: 1.5 },
  },
  /** Scripts. */
  'claude-haiku': {
    provider: 'claude',
    model: 'claude-haiku-4-5@20251001',
    location: 'global',
    usdPerMillion: { input: 1, output: 5 },
  },
  /** Second compile provider, so compile never depends on one vendor. */
  'gpt-oss-20b': {
    provider: 'gpt-oss',
    model: 'openai/gpt-oss-20b-maas',
    location: 'us-central1',
    usdPerMillion: { input: 0.07, output: 0.25 },
  },
} as const satisfies Record<string, TextModel>;

export type TextModelKey = keyof typeof TEXT_MODELS;

export const TEXT_MODEL_KEYS = Object.keys(TEXT_MODELS) as TextModelKey[];

/** What a call cost in rupees, for cost_telemetry (plan section 18). */
export function textCostInr(key: TextModelKey, usage: TokenUsage): number {
  const { input, output } = TEXT_MODELS[key].usdPerMillion;
  const usd = (usage.inputTokens * input + usage.outputTokens * output) / 1_000_000;
  return Number((usd * INR_PER_USD).toFixed(4));
}

export function isTextModelKey(key: string): key is TextModelKey {
  return key in TEXT_MODELS;
}
