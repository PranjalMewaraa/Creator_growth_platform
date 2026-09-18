import type { Logger } from '@cgp/config';
import type {
  ModerationAdapter,
  ObjectStore,
  Publisher,
  TargetPlatform,
  TextAdapter,
  TokenUsage,
} from '@cgp/contracts';
import { createFakeModeration, createFakePublisher } from './fakes';
import { createInstagramPublisher } from './publishers/instagram';
import { createLinkedInPublisher } from './publishers/linkedin';
import { createGcsStore } from './storage/gcs';
import { createMemoryStore } from './storage/memory';
import { createGoogleModeration } from './moderation/google';
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
  /** Chosen by MODERATION, separately from PROVIDERS (D3). */
  moderation: ModerationAdapter;
  /** Chosen by PUBLISHING: real ones make public posts, so they have their own switch. */
  publishers: Record<TargetPlatform, Publisher>;
  /** GCS when GCS_BUCKET is set, else in memory (enough for fake publishing). */
  store: ObjectStore;
  /** Realised cost of a text call in rupees; zero for fakes. */
  textCostInr: (adapterKey: string, usage: TokenUsage) => number;
}

/** Everything a process needs to call providers, chosen by PROVIDERS. */
export function createProviders(env: {
  PROVIDERS: ProviderMode;
  MODERATION?: 'fake' | 'google';
  PUBLISHING?: 'fake' | 'real';
  GCS_BUCKET?: string;
  GOOGLE_CLOUD_PROJECT?: string;
  log?: Logger;
}): Providers {
  if (env.PROVIDERS === 'real' && env.MODERATION !== 'google') {
    env.log?.warn('real providers with fake moderation: compiled prompts are not really checked');
  }
  const moderation =
    env.MODERATION === 'google'
      ? createGoogleModeration({ project: requireProject(env.GOOGLE_CLOUD_PROJECT), log: env.log })
      : createFakeModeration();
  const text =
    env.PROVIDERS === 'real'
      ? createTextAdapters('real', { project: env.GOOGLE_CLOUD_PROJECT ?? '', log: env.log })
      : createTextAdapters('fake');
  return {
    mode: env.PROVIDERS,
    text,
    rewriters: [text['gemini-flash-lite'], text['gpt-oss-20b']],
    moderation,
    publishers:
      env.PUBLISHING === 'real'
        ? {
            instagram: createInstagramPublisher({ log: env.log }),
            linkedin: createLinkedInPublisher({ log: env.log }),
          }
        : {
            instagram: createFakePublisher('instagram'),
            linkedin: createFakePublisher('linkedin'),
          },
    store: env.GCS_BUCKET
      ? createGcsStore({
          bucket: env.GCS_BUCKET,
          project: requireProject(env.GOOGLE_CLOUD_PROJECT),
          log: env.log,
        })
      : createMemoryStore(),
    textCostInr: (key, usage) =>
      env.PROVIDERS === 'real' && isTextModelKey(key) ? textCostInr(key, usage) : 0,
  };
}

function requireProject(project: string | undefined): string {
  if (!project)
    throw new Error('GOOGLE_CLOUD_PROJECT is required for Google moderation and storage');
  return project;
}
