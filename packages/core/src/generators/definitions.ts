import { TARGET_PLATFORMS } from '@cgp/contracts';
import { z } from 'zod';
import { createGeneratorRegistry, rateFor, register } from './registry';

// The demo's generators (FR-GN-03 to 08). Each entry says what it accepts, which compiler
// profile and adapter it uses, and how it prices against the versioned rates. None of them
// builds a prompt: the orchestration engine does that (invariant 4).

/** What the user supplies to every generator. Versions are resolved on the server. */
const base = {
  intentText: z.string().trim().min(1).max(2000),
  /** Optional until templates are seeded; orchestration falls back to the output type default. */
  templateId: z.uuid().optional(),
  /** Aspect ratio and length limits follow from this; the user is never asked for them. */
  targetPlatform: z.enum(TARGET_PLATFORMS).nullable().default(null),
  /** An explicit tone, which outranks the template's and the profile's (FR-PO-06). */
  tone: z.string().trim().min(1).max(80).optional(),
};

// Instructions the user did not give stay absent rather than defaulted here, so the template
// and profile defaults can apply; only quantities that set the price take a default.

/** Veo 3.1 Lite clips are 8 seconds; a reel is up to three of them (plan section 6). */
export const SECONDS_PER_SCENE = 8;

/** A thumbnail is bought as a set to choose between, not as one picture (plan section 7). */
export const THUMBNAIL_VARIANTS = 3;

/**
 * No Imagen model is served to this project, so images run on Gemini's image model (D18).
 * Switching back when Imagen appears is these two lines.
 */
const IMAGE_ADAPTER = 'gemini-flash-lite-image';

const script = register({
  key: 'script',
  outputType: 'script',
  jobClass: 'inference',
  inputSchema: z.object({
    ...base,
    durationSeconds: z.int().min(15).max(90).optional(),
  }),
  compilerProfile: 'script',
  // Claude Haiku is the plan's script model, but the project has no Haiku quota yet (D16),
  // so scripts run on Flash-Lite until it does. Switching back is this one line.
  providerAdapter: 'gemini-flash-lite',
  estimate: (_input, rates) => {
    const credits = rateFor(rates, 'script');
    return { credits, breakdown: [{ label: 'Script', credits }] };
  },
});

const hookTitleSet = register({
  key: 'hook_title_set',
  outputType: 'hook',
  jobClass: 'inference',
  inputSchema: z.object(base),
  compilerProfile: 'hook',
  providerAdapter: 'gemini-flash-lite',
  estimate: (_input, rates) => {
    const credits = rateFor(rates, 'hook_title_set');
    return { credits, breakdown: [{ label: 'Hook and title set', credits }] };
  },
});

const captionSet = register({
  key: 'caption_set',
  outputType: 'caption',
  jobClass: 'inference',
  inputSchema: z.object({
    ...base,
    /** Defaults to the target platform, or every platform when there is none. */
    platforms: z.array(z.enum(TARGET_PLATFORMS)).min(1).optional(),
  }),
  compilerProfile: 'caption',
  providerAdapter: 'gemini-flash-lite',
  estimate: (_input, rates) => {
    const credits = rateFor(rates, 'caption_set');
    return { credits, breakdown: [{ label: 'Caption set', credits }] };
  },
});

const image = register({
  key: 'image',
  outputType: 'image',
  jobClass: 'inference',
  inputSchema: z.object({ ...base, count: z.int().min(1).max(4).default(1) }),
  compilerProfile: 'image',
  providerAdapter: IMAGE_ADAPTER,
  estimate: (input, rates) => {
    const each = rateFor(rates, 'image_standard');
    return {
      credits: each * input.count,
      breakdown: [
        {
          label: input.count === 1 ? 'Image' : `Images x${input.count}`,
          credits: each * input.count,
        },
      ],
    };
  },
});

const thumbnailSet = register({
  key: 'thumbnail_set',
  outputType: 'thumbnail',
  jobClass: 'inference',
  inputSchema: z.object(base),
  compilerProfile: 'thumbnail',
  providerAdapter: IMAGE_ADAPTER,
  estimate: (_input, rates) => {
    const credits = rateFor(rates, 'thumbnail_set');
    return {
      credits,
      breakdown: [{ label: `Thumbnail set, ${THUMBNAIL_VARIANTS} variants`, credits }],
    };
  },
});

const video = register({
  key: 'video',
  outputType: 'video',
  jobClass: 'render',
  inputSchema: z.object({
    ...base,
    sceneCount: z.int().min(1).max(3).default(3),
    voiceover: z.boolean().default(true),
  }),
  compilerProfile: 'video',
  providerAdapter: 'veo-3.1-lite',
  // Video is paid in its own currency, held on the requested length and settled on what is
  // delivered (plan section 7).
  estimate: (input) => ({
    credits: 0,
    videoSeconds: input.sceneCount * SECONDS_PER_SCENE,
    breakdown: [],
  }),
});

export const generators = createGeneratorRegistry([
  script,
  hookTitleSet,
  captionSet,
  image,
  thumbnailSet,
  video,
]);
