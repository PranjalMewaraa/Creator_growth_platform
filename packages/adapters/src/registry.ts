import type { Logger } from '@cgp/config';
import type { ModerationAdapter, TextAdapter, TokenUsage } from '@cgp/contracts';
import { createFakeModeration } from './fakes';
import { isTextModelKey, TEXT_MODELS, textCostInr, type TextModelKey } from './models';
import { createClaudeText } from './text/claude';
import { createFakeText } from './text/fake';
import { createGeminiText } from './text/gemini';
import { createGptOssText } from './text/gpt-oss';

export type ProviderMode = 'fake' | 'real';

export interface RealProviderOptions {
  /** GCP project that Vertex bills; credentials come from application default credentials. */
  project: string;
  log?: Logger;
}

export type TextAdapters = Record<TextModelKey, TextAdapter>;

/**
 * Every text model behind one switch (PROVIDERS). Callers ask for a model key and get the same
 * TextAdapter shape either way, so the same call runs fake or real.
 */
export function createTextAdapters(mode: 'fake'): TextAdapters;
export function createTextAdapters(mode: ProviderMode, real: RealProviderOptions): TextAdapters;
export function createTextAdapters(mode: ProviderMode, real?: RealProviderOptions): TextAdapters {
  const entries = (Object.keys(TEXT_MODELS) as TextModelKey[]).map((key) => {
    if (mode === 'fake') return [key, createFakeText(key)] as const;
    if (!real?.project) throw new Error('PROVIDERS=real needs a GCP project');
    return [key, createRealText(key, real)] as const;
  });
  return Object.fromEntries(entries) as TextAdapters;
}

function createRealText(key: TextModelKey, { project, log }: RealProviderOptions): TextAdapter {
  const config = TEXT_MODELS[key];
  switch (config.provider) {
    case 'gemini':
      return createGeminiText({
        key,
        project,
        location: config.location,
        model: config.model,
        log,
      });
    case 'claude':
      return createClaudeText({ key, project, region: config.location, model: config.model, log });
    case 'gpt-oss':
      return createGptOssText({
        key,
        project,
        location: config.location,
        model: config.model,
        log,
      });
  }
}

export interface Providers {
  mode: ProviderMode;
  text: TextAdapters;
  /** The compile rewrite pass, in order: Flash-Lite, then gpt-oss (plan section 6). */
  rewriters: TextAdapter[];
  /**
   * The fake in both modes until the moderation service is chosen (D3, WP11): it allows
   * everything except `FAKE_BLOCK:` markers.
   */
  moderation: ModerationAdapter;
  /** Realised cost of a text call in rupees; zero for fakes. */
  textCostInr: (adapterKey: string, usage: TokenUsage) => number;
}

/** Everything a process needs to call providers, chosen by PROVIDERS. */
export function createProviders(env: {
  PROVIDERS: ProviderMode;
  GOOGLE_CLOUD_PROJECT?: string;
  log?: Logger;
}): Providers {
  const text =
    env.PROVIDERS === 'real'
      ? createTextAdapters('real', { project: env.GOOGLE_CLOUD_PROJECT ?? '', log: env.log })
      : createTextAdapters('fake');
  return {
    mode: env.PROVIDERS,
    text,
    rewriters: [text['gemini-flash-lite'], text['gpt-oss-20b']],
    moderation: createFakeModeration(),
    textCostInr: (key, usage) =>
      env.PROVIDERS === 'real' && isTextModelKey(key) ? textCostInr(key, usage) : 0,
  };
}
