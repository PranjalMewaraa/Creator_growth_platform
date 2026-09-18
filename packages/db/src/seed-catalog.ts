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
export const COMPILER_PROFILE_VERSION = 2;

const REWRITE_SYSTEM = [
  'You sharpen creative briefs for a content generator.',
  'Rewrite the brief so the intent is specific and concrete: name the angle, the audience and what the piece should make them feel or do.',
  'Keep every fact, name and number from the original. Do not invent claims, statistics or offers.',
  'Do not add formatting rules, lengths or requirements; those are added separately.',
  'Reply with the rewritten brief only, as plain prose, in under 120 words.',
].join(' ');

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
    brief: ['A short video script for {{platform}}.', 'Intent: {{intent}}', ...CONTEXT].join('\n'),
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
    brief: ['Hooks and titles for a post on {{platform}}.', 'Intent: {{intent}}', ...CONTEXT].join(
      '\n',
    ),
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
    brief: ['Post captions.', 'Intent: {{intent}}', ...CONTEXT].join('\n'),
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
      'Style: {{style}}',
    ].join('\n'),
    requirements: IMAGE_REQUIREMENTS,
    rewrite: {
      system:
        'You write image generation prompts. Turn the brief into one vivid visual description: subject, setting, light, lens and composition. Keep every named subject. Never ask for text in the image. Reply with the description only, in under 80 words.',
      maxOutputTokens: 250,
    },
    defaults: { style: 'natural light, editorial photography, shallow depth of field' },
  },
  thumbnail: {
    brief: [
      'A thumbnail background for a video on {{platform}}.',
      'Subject: {{intent}}',
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
      system:
        'You write image generation prompts for video thumbnails. Describe one bold, high contrast scene with a single clear subject. Never ask for text in the image. Reply with the description only, in under 80 words.',
      maxOutputTokens: 250,
    },
    defaults: { style: 'bold, high contrast, one clear subject', textSpace: true },
  },
  video: {
    brief: ['A short vertical video for {{platform}}.', 'Intent: {{intent}}', ...CONTEXT].join(
      '\n',
    ),
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
  },
};

/** Seeds compiler profiles and default templates. Existing versions are left untouched. */
export async function seedCatalogIn(tx: Drizzle): Promise<void> {
  for (const [outputType, config] of Object.entries(COMPILER_PROFILES) as Array<
    [OutputType, CompilerProfileConfig]
  >) {
    await tx
      .insert(compilerProfiles)
      .values({ key: `${outputType}.en`, outputType, version: COMPILER_PROFILE_VERSION, config })
      .onConflictDoNothing();

    const slug = `default-${outputType}`;
    await tx
      .insert(templates)
      .values({ slug, outputType, currentVersion: 1 })
      .onConflictDoNothing();
    const [template] = await tx.select().from(templates).where(eq(templates.slug, slug));
    if (!template) throw new Error(`Template ${slug} missing after insert`);
    const existing = await tx
      .select({ id: templateVersions.id })
      .from(templateVersions)
      .where(and(eq(templateVersions.templateId, template.id), eq(templateVersions.version, 1)));
    if (existing.length === 0) {
      await tx.insert(templateVersions).values({
        templateId: template.id,
        version: 1,
        // Text has no frame; images and video take theirs from the target platform.
        aspectRatio: 'none',
        modelTier: 'standard',
        compilerProfileRef: outputType,
        costBand: 'standard',
      });
    }
  }
}
