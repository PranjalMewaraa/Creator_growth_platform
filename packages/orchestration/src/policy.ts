import {
  PLATFORM_HASHTAG_LIMITS,
  PLATFORM_TEXT_LIMITS,
  type Directive,
  type OutputType,
  type TargetPlatform,
} from '@cgp/contracts';

// Safety policy and platform hard constraints: the two sources above the user (FR-PO-06).
// They live in code because nobody may configure them away.

export const CONTENT_POLICY =
  'Keep it safe for a general audience: nothing sexual, hateful, violent, harassing, self harming, dangerous or illegal.';

/** Invariant 12: text on images is composited as a vector layer, never rendered by the model. */
const NO_MODEL_TEXT: ReadonlySet<OutputType> = new Set(['image', 'thumbnail', 'video']);

export function safetyDirectives(outputType: OutputType): Directive[] {
  const directives: Directive[] = [
    { key: 'contentPolicy', value: CONTENT_POLICY, source: 'safety' },
  ];
  if (NO_MODEL_TEXT.has(outputType)) {
    directives.push({ key: 'noTextInImage', value: true, source: 'safety' });
  }
  return directives;
}

export const PLATFORM_NAMES: Record<TargetPlatform, string> = {
  instagram: 'Instagram',
  linkedin: 'LinkedIn',
};

/** Frames per platform. The user is never asked for an aspect ratio (FR-GN, plan week 4). */
const FRAMES: Partial<Record<OutputType, Record<TargetPlatform, string>>> = {
  image: { instagram: '4:5', linkedin: '1:1' },
  thumbnail: { instagram: '9:16', linkedin: '16:9' },
  video: { instagram: '9:16', linkedin: '9:16' },
};

/** The published limits, said in words for the model, so the numbers cannot drift apart. */
function captionLimit(platform: TargetPlatform): string {
  const chars = `at most ${PLATFORM_TEXT_LIMITS[platform].toLocaleString('en-IN')} characters`;
  const tags = PLATFORM_HASHTAG_LIMITS[platform];
  return `${PLATFORM_NAMES[platform]}: ${chars}${tags ? ` and ${tags} hashtags` : ''}.`;
}

export function platformDirectives(
  outputType: OutputType,
  target: TargetPlatform | null,
  captionPlatforms: TargetPlatform[],
): Directive[] {
  const directives: Directive[] = [];
  const frame = target ? FRAMES[outputType]?.[target] : undefined;
  if (frame) directives.push({ key: 'aspectRatio', value: frame, source: 'platform' });

  if (outputType === 'caption') {
    const platforms = captionPlatforms.length > 0 ? captionPlatforms : target ? [target] : [];
    if (platforms.length > 0) {
      directives.push({
        key: 'captionLimits',
        value: platforms.map(captionLimit).join(' '),
        source: 'platform',
      });
    }
  }
  return directives;
}
