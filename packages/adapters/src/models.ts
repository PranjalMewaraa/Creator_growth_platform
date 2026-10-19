import { INR_PER_USD } from '@cgp/config';
import type { ImageCapability, TokenUsage, VideoCapability, VoiceCapability } from '@cgp/contracts';

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
  /** What it will draw (WP36), so a request it cannot serve is refused before it is paid for. */
  capability: ImageCapability;
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
   *
   * Publicly this is "Nano Banana 2 Lite" — the id was already this before that name meant
   * anything to a creator (WP63); the key stays as it was rather than being renamed out from
   * under every compiled prompt and template version that already points at it by key.
   */
  'gemini-flash-lite-image': {
    model: 'gemini-3.1-flash-lite-image',
    location: 'global',
    usdPerMillion: { input: 0.25, output: 30 },
    capability: {
      // Measured against the model, not taken from a docs page: these are the ratios it
      // answered to on 2026-09-24, in the sizes the platforms want.
      aspectRatios: ['1:1', '4:5', '9:16', '16:9'],
      maxPerRequest: 4,
      outputMimeTypes: ['image/png', 'image/jpeg'],
      // Gemini's image model takes pictures alongside the prompt, which is what keeps a
      // storyboard's later frames in the same kitchen as its first (WP39).
      acceptsReferenceImages: true,
      maxReferenceImages: 3,
      // Vertex: GenContentImageGenRequestsPerMinutePerProjectPerBaseModelGlobal, read from
      // the quota API 2026-10-12. Fixed, and this project is not eligible to raise it.
      requestsPerMinute: 2,
    },
  },
  /**
   * "Nano Banana 2.1" (WP63), Google's own public name for it — confirmed against
   * ai.google.dev and docs.cloud.google.com on 2026-10-19: model id `gemini-nano-banana-2.1`,
   * global only, up to 14 reference images, pricing at $1.50/$7.50/$30 per million input/text-
   * output/image-output tokens (image-output lands at the same per-token rate as the Lite
   * model above; the cost difference is in the input and thinking tokens, not the picture
   * itself, at the 1K resolution this app asks for).
   *
   * The request quota below is NOT measured against this project the way the Lite model's is
   * — Vertex quotas are granted per base model and a newly-added one is not guaranteed the
   * same allowance. Treat this as a placeholder until it is checked against this project's own
   * quota page; a wrong guess here means either needless throttling or a 429 this project is
   * not set up to retry past.
   */
  'gemini-nano-banana-2-1': {
    model: 'gemini-nano-banana-2.1',
    location: 'global',
    usdPerMillion: { input: 1.5, output: 30 },
    capability: {
      aspectRatios: ['1:1', '4:5', '9:16', '16:9'],
      maxPerRequest: 4,
      outputMimeTypes: ['image/png', 'image/jpeg'],
      acceptsReferenceImages: true,
      // The model allows up to 14; this app offers up to 3 in Studio regardless of model, so
      // a creator moving between models never loses an upload the other one would have kept.
      maxReferenceImages: 14,
      // Unverified for this project — see the note above. Matches the Lite model's measured
      // value as the conservative assumption, not a confirmed one.
      requestsPerMinute: 2,
    },
  },
} as const satisfies Record<string, ImageModel>;

export type ImageModelKey = keyof typeof IMAGE_MODELS;

export const IMAGE_MODEL_KEYS = Object.keys(IMAGE_MODELS) as ImageModelKey[];

export const TEXT_MODEL_KEYS = Object.keys(TEXT_MODELS) as TextModelKey[];

/** Which constructor wires it (WP63): Veo's raw REST `predictLongRunning`/`fetchPredictOperation`
 *  pair, or Omni's Interactions API (`client.interactions.create`/`.get`) — different enough
 *  wire shapes that one generic constructor cannot serve both, the way createGeminiImage
 *  serves every image model because they all share one shape. */
export type VideoProvider = 'veo' | 'omni';

export interface VideoModel {
  provider: VideoProvider;
  model: string;
  /** Veo is regional; Omni answers on `global` like the Gemini-family models (D10). */
  location: string;
  /** USD per second of delivered video, by resolution (plan section 6). */
  usdPerSecond: Record<'720p' | '1080p', number>;
  /** What it will film (WP36). */
  capability: VideoCapability;
}

export const VIDEO_MODELS = {
  /**
   * The budget tier, and the only one allowed: Veo 3.1 costs four times as much and Veo 2 ten
   * times (plan section 6). Video only, no generated audio.
   */
  'veo-3.1-lite': {
    provider: 'veo',
    model: 'veo-3.1-lite-generate-001',
    location: 'us-central1',
    usdPerSecond: { '720p': 0.03, '1080p': 0.05 },
    capability: {
      aspectRatios: ['16:9', '9:16'],
      resolutions: ['720p', '1080p'],
      // Eight seconds, and only eight: the lite tier films one length (WP21).
      durationSeconds: { min: 8, max: 8, step: 8 },
      // It takes a still to start from, which is what WP38 films a storyboard frame with.
      acceptsStartImage: true,
      acceptsReferenceImages: false,
      maxReferenceImages: 0,
      generatesAudio: false,
      // Vertex: LongRunningPredictRequestsPerMinutePerProjectPerBaseModel, read from the
      // quota API 2026-10-12. One. Three scenes are therefore three minutes, and no amount
      // of concurrency changes that (WP41).
      requestsPerMinute: 1,
    },
  },
  /**
   * "Gemini Omni 1.1 Flash" (WP63), Google's own public name — confirmed against
   * docs.cloud.google.com on 2026-10-19: model id `gemini-omni-1.1-flash-preview`, global only,
   * up to 10 reference images, 10 second clips, generates its own audio by default. Unlike Veo
   * it answers through the Interactions API (`client.interactions.create`/`.get`), not
   * `predictLongRunning`/`fetchPredictOperation` — a different wire shape, wired for the first
   * time in this codebase in packages/adapters/src/video/omni.ts. That file's own comment says
   * what is and is not empirically verified yet; read it before trusting this one blind.
   *
   * Treated as one 8 second beat, the same atomic unit Veo already uses, rather than taking
   * advantage of its real 10s-per-call or 40s-with-extension ceiling: letting one model use a
   * different clip length would mean two duration systems in Studio instead of one, which is a
   * real feature, not a default to reach for silently.
   */
  'gemini-omni-1.1-flash': {
    provider: 'omni',
    model: 'gemini-omni-1.1-flash-preview',
    location: 'global',
    // Unverified: not found on a Google pricing page direct enough to quote (the pricing page
    // was too large to fetch whole). These are a secondary source's figures, kept only because
    // this number feeds cost telemetry, never a charge to a creator — confirm before trusting
    // it for anything that is.
    usdPerSecond: { '720p': 0.1, '1080p': 0.15 },
    capability: {
      aspectRatios: ['16:9', '9:16'],
      resolutions: ['720p', '1080p'],
      durationSeconds: { min: 8, max: 8, step: 8 },
      // First/last frame control exists, but is a different feature (two reference images with
      // a described transition) from Veo's "animate this one still" — not wired as
      // acceptsStartImage here to avoid silently changing what that flag means for every
      // caller that already checks it.
      acceptsStartImage: false,
      acceptsReferenceImages: true,
      maxReferenceImages: 3,
      generatesAudio: true,
      // Unverified for this project, the same caveat as Nano Banana 2.1 above: Vertex quotas
      // are granted per base model, and this is a newly added one.
      requestsPerMinute: 1,
    },
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

export interface VoiceModel {
  /** What it will speak, and whether it says where the words fell (WP36). */
  capability?: VoiceCapability;
  /** A voice id as Google names it. */
  name: string;
  language: string;
  /** USD per million characters of input, SSML tags included (docs/spikes/tts.md). */
  usdPerMillionChars: number;
}

export const VOICE_MODELS = {
  /**
   * Neural2, chosen in WP5: it returns timepoints at SSML marks, which captions are timed
   * from (invariant 13). Chirp 3 HD sounds better and returns none, so it cannot drive them.
   */
  'neural2-en-in': {
    name: 'en-IN-Neural2-A',
    language: 'en-IN',
    usdPerMillionChars: 16,
    // The reason this voice was chosen over a better sounding one, written down where the
    // choice is made rather than only in a comment.
    capability: { timepoints: true, languages: ['en-IN'] },
  },
} as const satisfies Record<string, VoiceModel>;

export type VoiceModelKey = keyof typeof VOICE_MODELS;

export const VOICE_MODEL_KEYS = Object.keys(VOICE_MODELS) as VoiceModelKey[];

/** What a voiceover cost in rupees, by the characters sent. Free inside the monthly allowance. */
export function voiceCostInr(key: VoiceModelKey, characters: number): number {
  const usd = (characters / 1_000_000) * VOICE_MODELS[key].usdPerMillionChars;
  return Number((usd * INR_PER_USD).toFixed(4));
}

export function isVoiceModelKey(key: string): key is VoiceModelKey {
  return key in VOICE_MODELS;
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
