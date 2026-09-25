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

export interface ImageModel {
  model: string;
  location: string;
  /**
   * USD per million tokens. An image is billed as output tokens, not per picture: a 4:5
   * 928x1152 costs 1120 of them, measured 2026-09-24.
   */
  usdPerMillion: { input: number; output: number };
}

export const IMAGE_MODELS = {
  /**
   * Imagen is the plan's image model, but no Imagen id is served to this project (D18), so
   * images run on Gemini's image model. Checked 2026-09-24 across five Vertex regions.
   */
  'gemini-flash-lite-image': {
    model: 'gemini-3.1-flash-lite-image',
    location: 'global',
    usdPerMillion: { input: 0.25, output: 30 },
  },
} as const satisfies Record<string, ImageModel>;

export type ImageModelKey = keyof typeof IMAGE_MODELS;

export const IMAGE_MODEL_KEYS = Object.keys(IMAGE_MODELS) as ImageModelKey[];

export const TEXT_MODEL_KEYS = Object.keys(TEXT_MODELS) as TextModelKey[];

export interface VideoModel {
  model: string;
  /** Veo is regional, unlike Gemini 3.x (D10). */
  location: string;
  /** USD per second of delivered video, by resolution (plan section 6). */
  usdPerSecond: Record<'720p' | '1080p', number>;
}

export const VIDEO_MODELS = {
  /**
   * The budget tier, and the only one allowed: Veo 3.1 costs four times as much and Veo 2 ten
   * times (plan section 6). Video only, no generated audio.
   */
  'veo-3.1-lite': {
    model: 'veo-3.1-lite-generate-001',
    location: 'us-central1',
    usdPerSecond: { '720p': 0.03, '1080p': 0.05 },
  },
} as const satisfies Record<string, VideoModel>;

export type VideoModelKey = keyof typeof VIDEO_MODELS;

export const VIDEO_MODEL_KEYS = Object.keys(VIDEO_MODELS) as VideoModelKey[];

/** What a clip cost in rupees, by the seconds actually delivered. */
export function videoCostInr(
  key: VideoModelKey,
  resolution: '720p' | '1080p',
  seconds: number,
): number {
  const usd = VIDEO_MODELS[key].usdPerSecond[resolution] * seconds;
  return Number((usd * INR_PER_USD).toFixed(4));
}

export function isVideoModelKey(key: string): key is VideoModelKey {
  return key in VIDEO_MODELS;
}

/** What a call cost in rupees, for cost_telemetry (plan section 18). */
export function textCostInr(key: TextModelKey, usage: TokenUsage): number {
  const { input, output } = TEXT_MODELS[key].usdPerMillion;
  const usd = (usage.inputTokens * input + usage.outputTokens * output) / 1_000_000;
  return Number((usd * INR_PER_USD).toFixed(4));
}

export function isTextModelKey(key: string): key is TextModelKey {
  return key in TEXT_MODELS;
}

/** What an image call cost in rupees. Same shape as text, on the image rate card. */
export function imageCostInr(key: ImageModelKey, usage: TokenUsage): number {
  const { input, output } = IMAGE_MODELS[key].usdPerMillion;
  const usd = (usage.inputTokens * input + usage.outputTokens * output) / 1_000_000;
  return Number((usd * INR_PER_USD).toFixed(4));
}

export function isImageModelKey(key: string): key is ImageModelKey {
  return key in IMAGE_MODELS;
}
