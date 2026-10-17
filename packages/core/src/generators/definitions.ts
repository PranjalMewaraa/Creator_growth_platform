import { isLookOption, type LookKey, TARGET_PLATFORMS } from '@cgp/contracts';
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

/**
 * The look (WP37), for the generators that make a picture or film one. Each part is a choice
 * from the pinned vocabulary, refused if it is not one this build knows, so an unknown id
 * cannot reach a prompt. Each outranks the template's and the profile's, like tone.
 */
const look = {
  camera: lookOption('camera'),
  lens: lookOption('lens'),
  focalLength: lookOption('focalLength'),
  aperture: lookOption('aperture'),
};

function lookOption(key: LookKey) {
  return z
    .string()
    .refine((id) => isLookOption(key, id), { message: `Not a ${key} this build knows` })
    .optional();
}

/**
 * A picture the creator uploaded for the image model to stay consistent with (WP60): the key
 * `storeReferenceImage` returned. Only the two generators whose provider accepts one take it —
 * Veo has no equivalent, so neither `storyboard` nor `video` gets this field.
 */
const reference = {
  referenceImageKey: z.string().min(1).optional(),
};

// Instructions the user did not give stay absent rather than defaulted here, so the template
// and profile defaults can apply; only quantities that set the price take a default.

/** Veo 3.1 Lite clips are 8 seconds; a reel is however many of them the scene planner uses to
 *  fill the requested length (WP59). */
export const SECONDS_PER_SCENE = 8;

/** The shortest and longest a creator can ask for: one beat, and as many as the 1-a-minute
 *  Veo render queue keeps to a reasonable wait (plan section 6, WP41). */
export const MIN_VIDEO_SECONDS = SECONDS_PER_SCENE;
export const MAX_VIDEO_SECONDS = SECONDS_PER_SCENE * 6;

/** The exact beat count a non-flexible plan lands on for a given target (packages/orchestration
 *  scenes.ts's sceneBounds in its non-flexible form, duplicated here since pricing has to hold
 *  an exact number before any plan exists to measure). A storyboard is charged this flat, so it
 *  asks the planner for exactly this many rather than the free-flowing range the final video
 *  gets, where settlement is on seconds actually delivered instead of a held frame count. */
function scenesFor(targetDurationSeconds: number): number {
  return Math.max(1, Math.round(targetDurationSeconds / SECONDS_PER_SCENE));
}

/** The most beats a flexible plan could come back with for a given target (scenes.ts's
 *  sceneBounds in its flexible form). The video hold is sized for this worst case; settling
 *  on seconds actually delivered means holding generously here costs nothing extra. */
function maxScenesFor(targetDurationSeconds: number): number {
  return scenesFor(targetDurationSeconds) + 1;
}

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
  inputSchema: z.object({
    ...base,
    ...look,
    ...reference,
    count: z.int().min(1).max(4).default(1),
  }),
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
  inputSchema: z.object({ ...base, ...look, ...reference }),
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

/**
 * The storyboard (WP26): one still per scene, from the image model, before committing to a
 * render. A still costs about a rupee of provider time against twenty one for a clip, so
 * seeing the reel before paying for it is the cheapest decision in the product.
 */
const storyboard = register({
  key: 'storyboard',
  // Compiled as a video, because that is the profile that knows how to plan scenes.
  outputType: 'video',
  jobClass: 'inference',
  inputSchema: z.object({
    ...base,
    ...look,
    targetDurationSeconds: z
      .int()
      .min(MIN_VIDEO_SECONDS)
      .max(MAX_VIDEO_SECONDS)
      .multipleOf(SECONDS_PER_SCENE)
      .default(24),
  }),
  compilerProfile: 'video',
  providerAdapter: IMAGE_ADAPTER,
  estimate: (input, rates) => {
    // Priced as the images it is: no separate rate to keep in step with the image one. The
    // hold is a flat charge (storyboard.ts settles on it, not on frames actually drawn), so
    // the plan is asked for exactly this many frames rather than a free-flowing range (WP59).
    const each = rateFor(rates, 'image_standard');
    const frames = scenesFor(input.targetDurationSeconds);
    const credits = each * frames;
    return {
      credits,
      breakdown: [{ label: `Storyboard, ${frames} frames`, credits }],
    };
  },
});

/**
 * One frame of a storyboard, drawn again (WP50). Its own generator because it is its own
 * price: a redraw costs one picture, not three, and the submit bar should say so.
 *
 * It takes the storyboard it is correcting rather than a fresh request, because the scene it
 * is redrawing was planned with the other two and re-planning would quietly move them.
 */
const redrawFrame = register({
  key: 'redraw_frame',
  // A storyboard is compiled as a video, and a frame of one is compiled the same way.
  outputType: 'video',
  jobClass: 'inference',
  inputSchema: z.object({
    ...base,
    ...look,
    /** The storyboard output being corrected. The frames come from it, not from a new plan. */
    storyboardOutputId: z.uuid(),
    frameIndex: z.int().min(0).max(2),
    /** What is wrong with it, in the user's words. Appended to the scene, never replacing it. */
    note: z.string().trim().min(1).max(200).optional(),
  }),
  compilerProfile: 'video',
  providerAdapter: IMAGE_ADAPTER,
  estimate: (_input, rates) => {
    const credits = rateFor(rates, 'image_standard');
    return { credits, breakdown: [{ label: 'Redraw one frame', credits }] };
  },
});

/**
 * One scene of a finished reel, filmed again (WP22, wired in WP50). The handler has existed
 * since the scene table did; what it never had was a way in, because nothing can be submitted
 * without a generator to price it. This is that entry: a scene costs what a scene costs.
 */
const regenerateScene = register({
  key: 'regenerate_scene',
  outputType: 'video',
  jobClass: 'render',
  inputSchema: z.object({
    ...base,
    ...look,
    /** The scene being filmed again. Its prompt is the one it was filmed from. */
    sceneId: z.uuid(),
  }),
  compilerProfile: 'video',
  providerAdapter: 'veo-3.1-lite',
  estimate: () => ({ credits: 0, videoSeconds: SECONDS_PER_SCENE, breakdown: [] }),
});

const video = register({
  key: 'video',
  outputType: 'video',
  jobClass: 'render',
  inputSchema: z.object({
    ...base,
    ...look,
    // How many eight-second beats a free-flowing sequence needs is for the scene planner to
    // decide, not the creator (WP59): a target length is asked for instead of a scene count.
    targetDurationSeconds: z
      .int()
      .min(MIN_VIDEO_SECONDS)
      .max(MAX_VIDEO_SECONDS)
      .multipleOf(SECONDS_PER_SCENE)
      .default(24),
    voiceover: z.boolean().default(true),
    /** The storyboard this reel was committed from, so it films what was approved. */
    storyboardOutputId: z.uuid().optional(),
  }),
  compilerProfile: 'video',
  providerAdapter: 'veo-3.1-lite',
  // Video is paid in its own currency, held on the requested length and settled on what is
  // delivered (plan section 7). The hold covers the most beats the planner could choose for
  // this target (WP59); settlement is on the seconds actually delivered regardless, so holding
  // generously here costs nothing extra if the planner lands on fewer.
  estimate: (input) => ({
    credits: 0,
    videoSeconds: maxScenesFor(input.targetDurationSeconds) * SECONDS_PER_SCENE,
    breakdown: [],
  }),
});

export const generators = createGeneratorRegistry([
  script,
  hookTitleSet,
  captionSet,
  image,
  thumbnailSet,
  storyboard,
  redrawFrame,
  regenerateScene,
  video,
]);
