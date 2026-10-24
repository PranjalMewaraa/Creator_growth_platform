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
  /** Stage 2 of compile (WP68): on by default. Off, the stage 1 brief is used as typed —
   *  the same path an already-skipped rewrite takes, just by choice instead of a timeout. */
  refine: z.boolean().default(true),
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

/**
 * An explicit frame (WP64), for the generators that make a picture or film one. Optional: left
 * unset, the platform's own frame still wins, which is why there was no control for this
 * before — a user directive already outranks a platform one in the resolver
 * (packages/orchestration/src/resolve.ts), so this needed only a field, not a precedence
 * change. image/thumbnail pick this up with no handler change at all, since both already read
 * the resolved setting (packages/core/src/handlers/image.ts); video does not read settings for
 * its frame today, so its handler reads this field directly instead.
 */
const aspectRatio = {
  aspectRatio: z.enum(['1:1', '4:5', '9:16', '16:9']).optional(),
};

function lookOption(key: LookKey) {
  return z
    .string()
    .refine((id) => isLookOption(key, id), { message: `Not a ${key} this build knows` })
    .optional();
}

/**
 * A picture the creator uploaded for the model to stay consistent with (WP60/63): the keys
 * `storeReferenceImage` returned. Every generator that takes one has a provider that reads it
 * — Veo does not, so `storyboard` and `redraw_frame` (pinned to Veo and Veo-shaped stills) are
 * the two that never get this field. Capped at 14, the highest ceiling any model this build
 * offers (Nano Banana 2.1/Pro, packages/adapters/src/models.ts) — this is only a sanity bound
 * against an absurd payload; the real per-model limit (3 for Lite, 10 for Omni, 0 for Veo) is
 * enforced downstream by `checkImage`/`checkVideo` (packages/contracts/src/capabilities.ts),
 * which can give the specific model's own number back to the creator.
 */
const reference = {
  referenceImageKeys: z.array(z.string().min(1)).max(14).optional(),
};

/**
 * Which image model answers the request (WP63): a picture a creator can see and change their
 * mind about, not a silent default. The keys have to match
 * packages/adapters/src/models.ts IMAGE_MODELS exactly — core cannot import that package
 * (adapters wires generators to real providers, never the other way), so they are named again
 * here, the same way SECONDS_PER_SCENE is named again in packages/orchestration/src/scenes.ts.
 */
const IMAGE_MODEL_CHOICES = [
  'gemini-flash-lite-image',
  'gemini-nano-banana-2-1',
  'gemini-3-pro-image',
] as const;
const imageModel = {
  imageModel: z.enum(IMAGE_MODEL_CHOICES).default('gemini-flash-lite-image'),
};

/** Same reasoning as imageModel above, for the one video generator whose provider is a real
 *  choice (WP63): storyboard, redraw and regenerate all stay pinned to Veo, since a reel
 *  committed from a storyboard has to be filmed by something that understands the storyboard's
 *  own frames the way Veo's `startImage` does — Omni's reference pictures are a style anchor,
 *  not "animate this exact still". */
const VIDEO_MODEL_CHOICES = ['veo-3.1-lite', 'gemini-omni-1.1-flash'] as const;
const videoModel = {
  videoModel: z.enum(VIDEO_MODEL_CHOICES).default('veo-3.1-lite'),
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
    ...imageModel,
    ...aspectRatio,
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
  inputSchema: z.object({ ...base, ...look, ...reference, ...imageModel }),
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
    /** The storyboard this reel was committed from, so it films what was approved. Forces Veo
     *  regardless of videoModel below (packages/core/src/handlers/video.ts): a storyboard's
     *  frames are stills for Veo's `startImage` to animate, not Omni's style references. */
    storyboardOutputId: z.uuid().optional(),
    ...reference,
    ...videoModel,
    // The render path WP64's comment here called out as needing real work before this could
    // be a field, rather than silently cropping a landscape clip into a portrait one, is now
    // generalised (WP66): REEL_FRAMES carries a `-16:9` pair alongside the vertical sizes, and
    // the caption/logo maths were already proportional to the frame rather than hardcoded to
    // it. Unset, or anything other than '16:9', still means vertical — the model's own
    // capability (checked in packages/core/src/handlers/video.ts) is what actually gates
    // whether a request for 16:9 is honoured, same as every other model-dependent field here.
    ...aspectRatio,
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
