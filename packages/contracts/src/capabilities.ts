import type { TargetPlatform } from './generator';

/**
 * What a model or a platform will accept, as data (WP36).
 *
 * Before this, every limit lived as a condition somewhere downstream: a string inside a
 * validator, a guard in a handler, an assumption in a generator's schema. Three times we paid
 * for a limit that was only written in one of those places and not the others. Declared here,
 * one table answers the same question for the engine, which refuses before spending, and for
 * the interface, which stops offering what cannot be done.
 *
 * These describe our own models and targets. They are not provider response shapes and never
 * become them (invariant 3).
 */

export interface ImageCapability {
  aspectRatios: readonly string[];
  /** Most pictures one call will return. */
  maxPerRequest: number;
  outputMimeTypes: readonly string[];
}

export interface VideoCapability {
  aspectRatios: readonly string[];
  resolutions: readonly string[];
  /** What one clip may run for, in whole seconds. */
  durationSeconds: { min: number; max: number; step: number };
  /** Whether a clip can start from a still, which is what filming a storyboard needs (WP38). */
  acceptsStartImage: boolean;
  /** Whether the model makes its own sound. Ours does not; the voice is ours to add. */
  generatesAudio: boolean;
}

export interface VoiceCapability {
  /**
   * Whether the voice reports where each mark fell. Without them captions would have to be
   * guessed from the audio, and invariant 13 says they are timed by the voice that spoke them.
   */
  timepoints: boolean;
  languages: readonly string[];
}

/** What a platform accepts in a post, beside its text limits. */
export interface PlatformMedia {
  /** Whether a post can go out as words alone. */
  textOnly: boolean;
  /** Picture types the platform will take, as mime types. Empty means it takes no picture. */
  imageMimeTypes: readonly string[];
  /** Whether video can be published there. Neither adapter does yet; saying so beats failing. */
  video: boolean;
}

export const PLATFORM_MEDIA: Record<TargetPlatform, PlatformMedia> = {
  instagram: { textOnly: false, imageMimeTypes: ['image/jpeg'], video: false },
  linkedin: { textOnly: true, imageMimeTypes: ['image/jpeg', 'image/png'], video: false },
};

/** A reason something was refused, in the words the person reading it needs. */
export interface CapabilityIssue {
  path: string;
  message: string;
}

export interface VideoCapabilityRequest {
  aspectRatio?: string;
  resolution?: string;
  durationSeconds?: number;
  startImage?: boolean;
}

/** Everything wrong with a video request, so one answer lists them all rather than the first. */
export function checkVideo(
  capability: VideoCapability,
  request: VideoCapabilityRequest,
): CapabilityIssue[] {
  const issues: CapabilityIssue[] = [];
  const { aspectRatio, resolution, durationSeconds, startImage } = request;

  if (aspectRatio && !capability.aspectRatios.includes(aspectRatio)) {
    issues.push({
      path: 'aspectRatio',
      message: `This model films ${list(capability.aspectRatios)}, not ${aspectRatio}`,
    });
  }
  if (resolution && !capability.resolutions.includes(resolution)) {
    issues.push({
      path: 'resolution',
      message: `This model films at ${list(capability.resolutions)}, not ${resolution}`,
    });
  }
  if (durationSeconds !== undefined) {
    const { min, max, step } = capability.durationSeconds;
    if (durationSeconds < min || durationSeconds > max) {
      issues.push({
        path: 'durationSeconds',
        message: `A clip runs between ${min} and ${max} seconds, not ${durationSeconds}`,
      });
    } else if ((durationSeconds - min) % step !== 0) {
      issues.push({
        path: 'durationSeconds',
        message: `A clip runs in steps of ${step} seconds from ${min}`,
      });
    }
  }
  if (startImage && !capability.acceptsStartImage) {
    issues.push({
      path: 'startImage',
      message: 'This model films from a description, not from a picture',
    });
  }
  return issues;
}

export interface ImageCapabilityRequest {
  aspectRatio?: string;
  count?: number;
}

export function checkImage(
  capability: ImageCapability,
  request: ImageCapabilityRequest,
): CapabilityIssue[] {
  const issues: CapabilityIssue[] = [];
  if (request.aspectRatio && !capability.aspectRatios.includes(request.aspectRatio)) {
    issues.push({
      path: 'aspectRatio',
      message: `This model draws ${list(capability.aspectRatios)}, not ${request.aspectRatio}`,
    });
  }
  if (request.count !== undefined && request.count > capability.maxPerRequest) {
    issues.push({
      path: 'count',
      message: `At most ${capability.maxPerRequest} pictures at a time`,
    });
  }
  return issues;
}

export interface PostMediaRequest {
  mimeType?: string;
  kind?: 'image' | 'video';
  hasText: boolean;
}

/**
 * Whether a platform will take this post. The rules were a pair of inline conditions in the
 * publishing path; a creator now learns about them in the composer, before writing.
 */
export function checkPostMedia(
  platform: TargetPlatform,
  request: PostMediaRequest,
): CapabilityIssue[] {
  const media = PLATFORM_MEDIA[platform];
  const name = platform === 'instagram' ? 'Instagram' : 'LinkedIn';
  const issues: CapabilityIssue[] = [];

  if (!request.kind) {
    if (!media.textOnly) issues.push({ path: 'media', message: `${name} posts need an image` });
    return issues;
  }
  if (request.kind === 'video' && !media.video) {
    issues.push({
      path: 'media',
      message: `${name} video is not published from here yet. Download the reel and post it by hand`,
    });
    return issues;
  }
  if (
    request.kind === 'image' &&
    request.mimeType &&
    !media.imageMimeTypes.includes(request.mimeType)
  ) {
    issues.push({
      path: 'media',
      message: `${name} takes ${list(media.imageMimeTypes.map(short))} pictures`,
    });
  }
  return issues;
}

function short(mimeType: string): string {
  return mimeType.replace('image/', '').toUpperCase().replace('JPEG', 'JPEG');
}

/** "a, b or c", because a refusal reads better as a sentence than as an array. */
function list(values: readonly string[]): string {
  if (values.length <= 1) return values[0] ?? 'nothing';
  return `${values.slice(0, -1).join(', ')} or ${values[values.length - 1]}`;
}
