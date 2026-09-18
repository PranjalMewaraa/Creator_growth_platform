import type { Logger } from '@cgp/config';
import type { TextAdapter } from '@cgp/contracts';
import { TEXT_MODELS, type TextModelKey } from './models';
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
