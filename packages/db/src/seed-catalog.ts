import type { CompilerProfileConfig, OutputType } from '@cgp/contracts';
import { and, eq } from 'drizzle-orm';
import type { Drizzle } from './client';
import { compilerProfiles, templates, templateVersions } from './schema';

// Catalog seed: compiler profiles and one default template per output type. Idempotent, so it
// runs on every seed, including against a database that already has demo data.
//
// Compiler profiles are immutable once seeded, because compiled prompts point at their
// versions (invariant 8). To change one, edit the config below and bump the version: the seed
// adds the new version and leaves the old ones for lineage. Compile always takes the newest.
//   v1  first seed
//   v2  context line names who is posting rather than an audience
//   v3  a template can set the angle, which is what makes one template differ from another
//   v4  video profiles say how a prompt is broken into scenes
//   v5  scenes and images are written as full shot specifications, not one line summaries
export const COMPILER_PROFILE_VERSION = 5;

const REWRITE_SYSTEM = [
  'You sharpen creative briefs for a content generator.',
  'Rewrite the brief so the intent is specific and concrete: name the angle, the audience and what the piece should make them feel or do.',
  'Keep every fact, name and number from the original. Do not invent claims, statistics or offers.',
  'Do not add formatting rules, lengths or requirements; those are added separately.',
  'Reply with the rewritten brief only, as plain prose, in under 120 words.',
].join(' ');

/** Set by a template (WP19). Templates without one lose the line, since empty lines drop. */
const ANGLE = 'Angle: {{angle}}';

const CONTEXT = [
  'Who is posting: {{creator}}.',
  'Content pillars: {{pillars}}.',
  'Current goal: {{goal}}.',
  'Brand tagline, for tone only: {{tagline}}.',
];

const COMMON_REQUIREMENTS = [
  { key: 'contentPolicy', line: '{{contentPolicy}}' },
  { key: 'language', line: 'Write in {{language}}.' },
  { key: 'tone', line: 'Tone: {{tone}}.' },
  { key: 'prohibitedWords', line: 'Never use these words: {{prohibitedWords}}.' },
];

const IMAGE_REQUIREMENTS = [
  { key: 'contentPolicy', line: '{{contentPolicy}}' },
  { key: 'noTextInImage', line: 'No text, letters, numbers, logos or watermarks anywhere.' },
  { key: 'aspectRatio', line: 'Compose for a {{aspectRatio}} frame.' },
  { key: 'brandColours', line: 'Lean on the brand colours {{brandColours}}.' },
  { key: 'tone', line: 'Mood: {{tone}}.' },
];

export const COMPILER_PROFILES: Record<OutputType, CompilerProfileConfig> = {
  script: {
    brief: ['A short video script for {{platform}}.', 'Intent: {{intent}}', ANGLE, ...CONTEXT].join(
      '\n',
    ),
    requirements: [
      ...COMMON_REQUIREMENTS,
      {
        key: 'durationSeconds',
        line: 'Length: about {{durationSeconds}} seconds spoken, {{wordBudget}} words at most.',
      },
      { key: 'scriptShape', line: '{{scriptShape}}' },
    ],
    rewrite: { system: REWRITE_SYSTEM, maxOutputTokens: 400 },
    generation: {
      system:
        'You write short form video scripts for Indian creators. Write only the words to be spoken, one short paragraph per beat, with no scene directions, labels or emoji.',
      maxOutputTokens: 700,
      temperature: 0.8,
    },
    defaults: {
      durationSeconds: 30,
      scriptShape: 'Open with a hook in the first sentence and end with one clear call to action.',
    },
  },
  hook: {
    brief: [
      'Hooks and titles for a post on {{platform}}.',
      'Intent: {{intent}}',
      ANGLE,
      ...CONTEXT,
    ].join('\n'),
    requirements: [
      ...COMMON_REQUIREMENTS,
      { key: 'hookCount', line: 'Give {{hookCount}} opening hooks and {{hookCount}} titles.' },
      { key: 'maxHookWords', line: 'Each hook at most {{maxHookWords}} words.' },
      { key: 'outputShape', line: '{{outputShape}}' },
    ],
    rewrite: { system: REWRITE_SYSTEM, maxOutputTokens: 300 },
    generation: {
      system: 'You write scroll stopping hooks and titles for Indian creators.',
      maxOutputTokens: 500,
      temperature: 0.9,
      format: 'json',
    },
    defaults: {
      hookCount: 5,
      maxHookWords: 12,
      outputShape: 'Reply with JSON: {"hooks": string[], "titles": string[]}.',
    },
  },
  caption: {
    brief: ['Post captions.', 'Intent: {{intent}}', ANGLE, ...CONTEXT].join('\n'),
    requirements: [
      ...COMMON_REQUIREMENTS,
      { key: 'platforms', line: 'Write one caption for each of: {{platforms}}.' },
      { key: 'captionLimits', line: '{{captionLimits}}' },
      { key: 'hashtagsMax', line: 'At most {{hashtagsMax}} hashtags per caption.' },
      { key: 'outputShape', line: '{{outputShape}}' },
    ],
    rewrite: { system: REWRITE_SYSTEM, maxOutputTokens: 300 },
    generation: {
      system:
        'You write social captions for Indian creators that sound like a person, not a brand.',
      maxOutputTokens: 900,
      temperature: 0.8,
      format: 'json',
    },
    defaults: {
      hashtagsMax: 5,
      outputShape: 'Reply with JSON: {"captions": {"<platform>": string}}.',
    },
  },
  image: {
    brief: [
      'A photograph for a post on {{platform}}.',
      'Subject: {{intent}}',
      ANGLE,
      'Style: {{style}}',
    ].join('\n'),
    requirements: IMAGE_REQUIREMENTS,
    rewrite: {
      // Same reasoning as the video scenes: an image model returns the detail it is given.
      system: [
        'You write image generation prompts as a full shot specification, not a summary.',
        'Write labelled lines, in this order, each on its own line:',
        'SHOT: the framing and lens.',
        'SUBJECT: what is in frame, with the material detail that makes it specific: surface, texture, wear, age, colour.',
        'SETTING: the place, the hour, the weather, and what is behind the subject.',
        'LIGHT: the sources, their direction and quality, and what is in shadow.',
        'PALETTE: three or four colours that dominate the frame.',
        'COMPOSITION: where the subject sits in the frame and what is left empty.',
        'Keep every subject, fact and name from the brief, and invent no claim or offer.',
        'Never ask for text, letters, numbers, logos or watermarks in the image.',
        'Reply with the specification only, 80 to 140 words.',
      ].join(' '),
      maxOutputTokens: 500,
    },
    defaults: { style: 'natural light, editorial photography, shallow depth of field' },
  },
  thumbnail: {
    brief: [
      'A thumbnail background for a video on {{platform}}.',
      'Subject: {{intent}}',
      ANGLE,
      'Style: {{style}}',
    ].join('\n'),
    requirements: [
      ...IMAGE_REQUIREMENTS,
      {
        key: 'textSpace',
        line: 'Leave clear space for a headline, which is added later as a separate layer.',
      },
    ],
    rewrite: {
      system: [
        'You write thumbnail prompts as a full shot specification, not a summary.',
        'Write labelled lines, in this order, each on its own line:',
        'SHOT: the framing and lens, close enough to read at the size of a thumb.',
        'SUBJECT: one clear subject, with the material detail that makes it specific, and the expression or gesture it holds.',
        'SETTING: the place and what is behind the subject, kept simple enough not to compete.',
        'LIGHT: hard or soft, its direction, and the rim or separation that lifts the subject off the background.',
        'PALETTE: three colours at most, high contrast.',
        'COMPOSITION: the subject to one side, and the empty space where a headline will be added later.',
        'Never ask for text, letters, numbers, logos or watermarks in the image.',
        'Reply with the specification only, 80 to 140 words.',
      ].join(' '),
      maxOutputTokens: 500,
    },
    defaults: { style: 'bold, high contrast, one clear subject', textSpace: true },
  },
  video: {
    brief: [
      'A short vertical video for {{platform}}.',
      'Intent: {{intent}}',
      ANGLE,
      ...CONTEXT,
    ].join('\n'),
    requirements: [
      { key: 'contentPolicy', line: '{{contentPolicy}}' },
      { key: 'noTextInImage', line: 'No on screen text in the footage; captions are added later.' },
      { key: 'aspectRatio', line: 'Frame for {{aspectRatio}}.' },
      { key: 'sceneCount', line: '{{sceneCount}} scenes of 8 seconds each.' },
      {
        key: 'voiceover',
        line: 'A voiceover will be added, so keep the footage free of dialogue.',
      },
      { key: 'tone', line: 'Mood: {{tone}}.' },
    ],
    rewrite: { system: REWRITE_SYSTEM, maxOutputTokens: 400 },
    scenes: {
      // A video model gives back what it is told, in the detail it is told it. A one line
      // summary produces a stock looking eight seconds; a full shot specification produces a
      // shot. Each scene is written as one, and the sections are the ones a director would
      // hand a camera operator.
      system: [
        'You write shot specifications for a short vertical reel, one per scene, in order.',
        'Each scene is ONE continuous eight second shot. Never describe a cut, a split screen or a freeze frame inside a scene: the camera may move, the subject may move, but the shot does not end until the scene does.',
        'Write each scene as labelled lines, in this order, each on its own line:',
        'SHOT: the framing and lens, such as tight close up on a 50mm, or a wide on a 24mm.',
        'SUBJECT: who or what is in frame, with the material detail that makes it specific: fabric, surface, wear, age, colour.',
        'ACTION: what happens across the eight seconds, in the order it happens, as one continuous movement.',
        'CAMERA: one move and one only, named plainly: slow push in, arc right, static, handheld drift, tilt up.',
        'SETTING: the place, the hour, the weather, and what is behind the subject.',
        'LIGHT: the sources, their direction and colour, and what is in shadow.',
        'PALETTE: three or four colours that dominate the frame.',
        'TEXTURE: how cloth, hair, water, steam, dust or smoke behave in this shot.',
        'MOOD: the feeling in three or four words.',
        'Carry the same subject, costume, location and palette across every scene, in the same words, so the scenes read as one piece rather than three unrelated shots.',
        'The scenes must tell one story in order, and the last must land the point of the brief.',
        'Never ask for on screen text, captions, subtitles, logos or watermarks: they are composited later and a model that renders them ruins the frame.',
        'Keep every fact, name and number from the brief. Invent no claim, statistic or offer.',
        'Reply with JSON: {"scenes": string[]}, one entry per scene, 90 to 150 words each.',
      ].join(' '),
      maxOutputTokens: 2400,
      fallback: 'Scene {{n}} of {{of}}, one continuous eight second shot.',
    },
  },
};

export interface TemplateSeed {
  slug: string;
  title: string;
  description: string;
  outputType: OutputType;
  /** Template source directives: they beat the output type's defaults, and nothing else. */
  styleParams: Record<string, string | number | boolean>;
  costBand: string;
}

/**
 * The gallery (WP19, FR-TP). Ten templates, each a real difference in the compiled prompt
 * rather than a label: the angle and the shape parameters below land as template source
 * directives, which the safety policy, the platform and an explicit user instruction still
 * outrank. Curating these down, or adding to them, is this list and a seed.
 */
export const TEMPLATE_SEEDS: TemplateSeed[] = [
  {
    slug: 'myth-buster',
    title: 'Myth buster',
    description: 'Name the belief, break it, leave the better rule.',
    outputType: 'script',
    styleParams: {
      angle: 'correct a belief the audience holds, without mocking anyone for holding it',
      scriptShape:
        'State the myth in the first sentence, say plainly that it is wrong, give the evidence in one beat, then the rule to follow instead.',
    },
    costBand: 'standard',
  },
  {
    slug: 'how-i-do-it',
    title: 'How I do it',
    description: 'Your method, in the order you actually do it.',
    outputType: 'script',
    styleParams: {
      angle: 'walk through your own method step by step, in the order you do it',
      scriptShape:
        'Say what the result is first, then three numbered steps, then the one step people skip.',
      durationSeconds: 45,
    },
    costBand: 'standard',
  },
  {
    slug: 'behind-the-scenes',
    title: 'Behind the scenes',
    description: 'The unglamorous middle of the work.',
    outputType: 'script',
    styleParams: {
      angle: 'show the unglamorous part of the work that the finished post never shows',
      scriptShape:
        'Open inside the moment, no preamble. Keep it to one scene, and end on what it cost or taught.',
    },
    costBand: 'standard',
  },
  {
    slug: 'customer-story',
    title: 'Customer story',
    description: 'One person, one change, one number.',
    outputType: 'script',
    styleParams: {
      angle: 'tell one customer’s change, in their words where possible, without inventing quotes',
      scriptShape:
        'Where they started, what changed, where they are now. One concrete detail in each beat.',
      durationSeconds: 45,
    },
    costBand: 'standard',
  },
  {
    slug: 'listicle-hooks',
    title: 'Listicle hooks',
    description: 'Numbered openers that promise a payoff.',
    outputType: 'hook',
    styleParams: {
      angle: 'promise a specific, countable payoff',
      hookCount: 6,
      maxHookWords: 10,
    },
    costBand: 'standard',
  },
  {
    slug: 'question-hooks',
    title: 'Question hooks',
    description: 'Open on the question they are already asking.',
    outputType: 'hook',
    styleParams: {
      angle: 'open on the question the audience is already asking themselves',
      hookCount: 6,
      maxHookWords: 12,
    },
    costBand: 'standard',
  },
  {
    slug: 'launch-captions',
    title: 'Launch captions',
    description: 'Announce something new, once, clearly.',
    outputType: 'caption',
    styleParams: {
      angle: 'announce something new and say plainly what to do about it',
      hashtagsMax: 8,
    },
    costBand: 'standard',
  },
  {
    slug: 'story-captions',
    title: 'Story captions',
    description: 'A small story, then the point.',
    outputType: 'caption',
    styleParams: {
      angle: 'open with a two line story from the day, then the point it makes',
      hashtagsMax: 3,
    },
    costBand: 'standard',
  },
  {
    slug: 'product-on-surface',
    title: 'Product on a surface',
    description: 'The thing itself, lit like a catalogue.',
    outputType: 'image',
    styleParams: {
      angle: 'the product alone, close, as the hero of the frame',
      style: 'soft daylight, matte surface, shallow depth of field, uncluttered background',
    },
    costBand: 'standard',
  },
  {
    slug: 'bold-face-thumbnail',
    title: 'Bold face thumbnail',
    description: 'One face, one emotion, room for a headline.',
    outputType: 'thumbnail',
    styleParams: {
      angle: 'one person reacting, filling the left of the frame',
      style: 'hard light, saturated colour, one clear subject, empty space on the right',
    },
    costBand: 'standard',
  },
];

/** Seeds compiler profiles, the default template per output type, and the gallery. */
export async function seedCatalogIn(tx: Drizzle): Promise<void> {
  for (const [outputType, config] of Object.entries(COMPILER_PROFILES) as Array<
    [OutputType, CompilerProfileConfig]
  >) {
    await tx
      .insert(compilerProfiles)
      .values({ key: `${outputType}.en`, outputType, version: COMPILER_PROFILE_VERSION, config })
      .onConflictDoNothing();

    await seedTemplate(tx, {
      slug: `default-${outputType}`,
      title: `Plain ${outputType}`,
      description: 'No angle of its own: your intent, your profile, nothing added.',
      outputType,
      styleParams: {},
      costBand: 'standard',
    });
  }

  for (const seed of TEMPLATE_SEEDS) await seedTemplate(tx, seed);
}

/**
 * One template and its version 1. Idempotent: an existing template keeps its versions, because
 * compiled prompts point at them (invariant 8), but its name and description are refreshed,
 * since those are only ever shown to a person.
 */
async function seedTemplate(tx: Drizzle, seed: TemplateSeed): Promise<void> {
  const { slug, title, description, outputType } = seed;
  await tx
    .insert(templates)
    .values({ slug, outputType, currentVersion: 1, title, description })
    .onConflictDoUpdate({ target: templates.slug, set: { title, description } });
  const [template] = await tx.select().from(templates).where(eq(templates.slug, slug));
  if (!template) throw new Error(`Template ${slug} missing after insert`);
  const existing = await tx
    .select({ id: templateVersions.id })
    .from(templateVersions)
    .where(and(eq(templateVersions.templateId, template.id), eq(templateVersions.version, 1)));
  if (existing.length > 0) return;
  await tx.insert(templateVersions).values({
    templateId: template.id,
    version: 1,
    // Text has no frame; images and video take theirs from the target platform.
    aspectRatio: 'none',
    modelTier: 'standard',
    compilerProfileRef: outputType,
    styleParams: seed.styleParams,
    costBand: seed.costBand,
  });
}
