import type { Logger } from '@cgp/config';
import type {
  ImageAdapter,
  VideoAdapter,
  VoiceAdapter,
  ModerationAdapter,
  ObjectStore,
  Publisher,
  TargetPlatform,
  TextAdapter,
  ImageCapability,
  TokenUsage,
  VideoCapability,
} from '@cgp/contracts';
import {
  createFakeImage,
  createFakeModeration,
  createFakePublisher,
  createFakeVideo,
  createFakeVoice,
} from './fakes';
import { createGeminiImage } from './image/gemini';
import { createGoogleVoice } from './voice/google';
import { createStubVideo } from './video/stub';
import { createVeoVideo } from './video/veo';
import { createInstagramPublisher } from './publishers/instagram';
import { createLinkedInPublisher } from './publishers/linkedin';
import { createGcsStore } from './storage/gcs';
import { createMemoryStore } from './storage/memory';
import { createGoogleModeration } from './moderation/google';
import {
  VOICE_MODELS,
  VIDEO_MODELS,
  IMAGE_MODELS,
  imageCostInr,
  isImageModelKey,
  isTextModelKey,
  isVideoModelKey,
  isVoiceModelKey,
  videoCostInr,
  voiceCostInr,
  TEXT_MODELS,
  textCostInr,
  type ImageModelKey,
  type TextModelKey,
  type VideoModelKey,
  type VoiceModelKey,
} from './models';
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

export type ImageAdapters = Record<ImageModelKey, ImageAdapter>;

/** Every image model behind the same switch as text, and the same adapter shape either way. */
export function createImageAdapters(mode: 'fake'): ImageAdapters;
export function createImageAdapters(mode: ProviderMode, real: RealProviderOptions): ImageAdapters;
export function createImageAdapters(mode: ProviderMode, real?: RealProviderOptions): ImageAdapters {
  const entries = (Object.keys(IMAGE_MODELS) as ImageModelKey[]).map((key) => {
    if (mode === 'fake') return [key, createFakeImage(key)] as const;
    if (!real?.project) throw new Error('PROVIDERS=real needs a GCP project');
    const config = IMAGE_MODELS[key];
    return [
      key,
      createGeminiImage({
        key,
        project: real.project,
        location: config.location,
        model: config.model,
        // The quota the model declares, so the pacer and the refusal come from one fact.
        requestsPerMinute: config.capability.requestsPerMinute,
        log: real.log,
      }),
    ] as const;
  });
  return Object.fromEntries(entries) as ImageAdapters;
}

/** Both video providers: the one that generates, and the wired stub (FR-VD-17). */
export type VideoAdapters = Record<VideoModelKey | 'second', VideoAdapter>;

export function createVideoAdapters(mode: 'fake'): VideoAdapters;
export function createVideoAdapters(mode: ProviderMode, real: RealProviderOptions): VideoAdapters;
export function createVideoAdapters(mode: ProviderMode, real?: RealProviderOptions): VideoAdapters {
  const entries = (Object.keys(VIDEO_MODELS) as VideoModelKey[]).map((key) => {
    if (mode === 'fake') return [key, createFakeVideo(key)] as const;
    if (!real?.project) throw new Error('PROVIDERS=real needs a GCP project');
    const config = VIDEO_MODELS[key];
    return [
      key,
      createVeoVideo({
        key,
        project: real.project,
        location: config.location,
        model: config.model,
        log: real.log,
      }),
    ] as const;
  });
  // The second provider is a stub in both modes: there is no account to switch on.
  return Object.fromEntries([...entries, ['second', createStubVideo()]]) as VideoAdapters;
}

export type VoiceAdapters = Record<VoiceModelKey, VoiceAdapter>;

/** The voices, chosen by the same switch as everything else. */
export function createVoiceAdapters(mode: 'fake'): VoiceAdapters;
export function createVoiceAdapters(mode: ProviderMode, real: RealProviderOptions): VoiceAdapters;
export function createVoiceAdapters(mode: ProviderMode, real?: RealProviderOptions): VoiceAdapters {
  const entries = (Object.keys(VOICE_MODELS) as VoiceModelKey[]).map((key) => {
    if (mode === 'fake') return [key, createFakeVoice(key)] as const;
    if (!real?.project) throw new Error('PROVIDERS=real needs a GCP project');
    const config = VOICE_MODELS[key];
    return [
      key,
      createGoogleVoice({
        key,
        project: real.project,
        voice: config.name,
        language: config.language,
        log: real.log,
      }),
    ] as const;
  });
  return Object.fromEntries(entries) as VoiceAdapters;
}

export interface Providers {
  mode: ProviderMode;
  text: TextAdapters;
  image: ImageAdapters;
  video: VideoAdapters;
  voice: VoiceAdapters;
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
  /** Realised cost of an image call in rupees; zero for fakes. */
  imageCostInr: (adapterKey: string, usage: TokenUsage) => number;
  /** Realised cost of a clip in rupees, by the seconds delivered; zero for fakes. */
  videoCostInr: (adapterKey: string, resolution: '720p' | '1080p', seconds: number) => number;
  /** Realised cost of a voiceover in rupees, by the characters sent; zero for fakes. */
  voiceCostInr: (adapterKey: string, characters: number) => number;
  /** What a video model will film (WP36). Undefined for a key this build does not know. */
  videoCapability: (adapterKey: string) => VideoCapability | undefined;
  /** What an image model will draw, including whether it reads references (WP36, WP39). */
  imageCapability: (adapterKey: string) => ImageCapability | undefined;
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
  const voice =
    env.PROVIDERS === 'real'
      ? createVoiceAdapters('real', { project: env.GOOGLE_CLOUD_PROJECT ?? '', log: env.log })
      : createVoiceAdapters('fake');
  const video =
    env.PROVIDERS === 'real'
      ? createVideoAdapters('real', { project: env.GOOGLE_CLOUD_PROJECT ?? '', log: env.log })
      : createVideoAdapters('fake');
  const image =
    env.PROVIDERS === 'real'
      ? createImageAdapters('real', { project: env.GOOGLE_CLOUD_PROJECT ?? '', log: env.log })
      : createImageAdapters('fake');
  return {
    mode: env.PROVIDERS,
    text,
    image,
    video,
    voice,
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
    imageCostInr: (key, usage) =>
      env.PROVIDERS === 'real' && isImageModelKey(key) ? imageCostInr(key, usage) : 0,
    videoCostInr: (key, resolution, seconds) =>
      env.PROVIDERS === 'real' && isVideoModelKey(key) ? videoCostInr(key, resolution, seconds) : 0,
    voiceCostInr: (key, characters) =>
      env.PROVIDERS === 'real' && isVoiceModelKey(key) ? voiceCostInr(key, characters) : 0,
    // The capability is the model's, whether the call is real or faked: a fake that accepted
    // what the real model refuses would hide the refusal until it cost money.
    videoCapability: (key) => (isVideoModelKey(key) ? VIDEO_MODELS[key].capability : undefined),
    imageCapability: (key) => (isImageModelKey(key) ? IMAGE_MODELS[key].capability : undefined),
  };
}

function requireProject(project: string | undefined): string {
  if (!project)
    throw new Error('GOOGLE_CLOUD_PROJECT is required for Google moderation and storage');
  return project;
}
