import { describe, expect, it } from 'vitest';
import {
  checkImage,
  checkPostMedia,
  checkVideo,
  PLATFORM_MEDIA,
  type ImageCapability,
  type VideoCapability,
} from './capabilities';

const veo: VideoCapability = {
  aspectRatios: ['16:9', '9:16'],
  resolutions: ['720p', '1080p'],
  durationSeconds: { min: 8, max: 8, step: 8 },
  acceptsStartImage: true,
  generatesAudio: false,
};

const gemini: ImageCapability = {
  aspectRatios: ['1:1', '4:5', '9:16', '16:9'],
  maxPerRequest: 4,
  outputMimeTypes: ['image/png', 'image/jpeg'],
};

describe('what a video model will film (WP36)', () => {
  it('passes a clip it can make', () => {
    expect(
      checkVideo(veo, { aspectRatio: '9:16', resolution: '720p', durationSeconds: 8 }),
    ).toEqual([]);
  });

  it('refuses a shape, a resolution or a length it cannot do, and says what it can', () => {
    const issues = checkVideo(veo, {
      aspectRatio: '1:1',
      resolution: '4K',
      durationSeconds: 20,
    });
    expect(issues.map((issue) => issue.path)).toEqual([
      'aspectRatio',
      'resolution',
      'durationSeconds',
    ]);
    // All of them at once: one answer listing every reason beats three round trips.
    expect(issues[0]?.message).toBe('This model films 16:9 or 9:16, not 1:1');
    expect(issues[1]?.message).toBe('This model films at 720p or 1080p, not 4K');
  });

  it('refuses a length between the steps', () => {
    const flexible: VideoCapability = {
      ...veo,
      durationSeconds: { min: 4, max: 12, step: 4 },
    };
    expect(checkVideo(flexible, { durationSeconds: 8 })).toEqual([]);
    expect(checkVideo(flexible, { durationSeconds: 6 })[0]?.message).toBe(
      'A clip runs in steps of 4 seconds from 4',
    );
  });

  it('refuses a still to start from when the model only works from words', () => {
    const wordsOnly: VideoCapability = { ...veo, acceptsStartImage: false };
    expect(checkVideo(wordsOnly, { startImage: true })[0]?.path).toBe('startImage');
    expect(checkVideo(veo, { startImage: true })).toEqual([]);
  });

  it('says nothing about what was not asked', () => {
    expect(checkVideo(veo, {})).toEqual([]);
  });
});

describe('what an image model will draw', () => {
  it('refuses a ratio it does not draw and a count beyond one call', () => {
    expect(checkImage(gemini, { aspectRatio: '21:9' })[0]?.path).toBe('aspectRatio');
    expect(checkImage(gemini, { count: 9 })[0]?.message).toBe('At most 4 pictures at a time');
    expect(checkImage(gemini, { aspectRatio: '4:5', count: 1 })).toEqual([]);
  });
});

describe('what a platform will take', () => {
  it('needs a picture for Instagram and allows LinkedIn to post words alone', () => {
    expect(checkPostMedia('instagram', { hasText: true })[0]?.message).toBe(
      'Instagram posts need an image',
    );
    expect(checkPostMedia('linkedin', { hasText: true })).toEqual([]);
  });

  it('refuses a PNG to Instagram, which takes JPEG', () => {
    expect(
      checkPostMedia('instagram', { kind: 'image', mimeType: 'image/png', hasText: true })[0]
        ?.message,
    ).toBe('Instagram takes JPEG pictures');
    expect(
      checkPostMedia('linkedin', { kind: 'image', mimeType: 'image/png', hasText: true }),
    ).toEqual([]);
  });

  it('says video is not published from here, rather than failing at the platform', () => {
    for (const platform of ['instagram', 'linkedin'] as const) {
      expect(PLATFORM_MEDIA[platform].video).toBe(false);
      expect(checkPostMedia(platform, { kind: 'video', hasText: true })[0]?.message).toContain(
        'not published from here yet',
      );
    }
  });
});
