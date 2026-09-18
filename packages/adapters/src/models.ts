// Model ids live here and nowhere else. Changing one needs a pricing check first (plan
// section 17): the rate card is keyed on these, and a new id can mean a new price.

export type TextProvider = 'gemini' | 'claude' | 'gpt-oss';

export interface TextModel {
  provider: TextProvider;
  model: string;
  /** Vertex location for the call. Gemini 3.x and Claude answer on `global` (D10). */
  location: string;
}

export const TEXT_MODELS = {
  /** Default compile provider and the cheap workhorse (plan section 6). */
  'gemini-flash-lite': { provider: 'gemini', model: 'gemini-3.1-flash-lite', location: 'global' },
  /** Scripts. */
  'claude-haiku': { provider: 'claude', model: 'claude-haiku-4-5@20251001', location: 'global' },
  /** Second compile provider, so compile never depends on one vendor. */
  'gpt-oss-20b': { provider: 'gpt-oss', model: 'openai/gpt-oss-20b-maas', location: 'us-central1' },
} as const satisfies Record<string, TextModel>;

export type TextModelKey = keyof typeof TEXT_MODELS;

export const TEXT_MODEL_KEYS = Object.keys(TEXT_MODELS) as TextModelKey[];
