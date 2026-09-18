import { describe, expect, it } from 'vitest';
import {
  createFakeImage,
  createFakeModeration,
  createFakePublisher,
  createFakeVideo,
  createFakeVoice,
} from './index';

const account = { externalId: 'acct', accessToken: 'token' };

describe('fake image', () => {
  it('returns real PNGs at the aspect ratio asked for', async () => {
    const { images } = await createFakeImage().generate({
      prompt: 'a desk',
      aspectRatio: '4:5',
      count: 2,
    });
    expect(images).toHaveLength(2);
    for (const image of images) {
      const bytes = Buffer.from(image.data);
      expect(bytes.subarray(0, 8)).toEqual(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      );
      expect(bytes.readUInt32BE(16)).toBe(256);
      expect(bytes.readUInt32BE(20)).toBe(320);
      expect(image).toMatchObject({ width: 256, height: 320, mimeType: 'image/png' });
    }
  });

  it('fails on request', async () => {
    await expect(
      createFakeImage().generate({ prompt: 'FAKE_FAIL:retriable', aspectRatio: '1:1', count: 1 }),
    ).rejects.toMatchObject({ category: 'retriable' });
  });
});

describe('fake video', () => {
  it('runs once, then returns an mp4', async () => {
    const video = createFakeVideo();
    const { operationId } = await video.submit({
      prompt: 'a street',
      aspectRatio: '9:16',
      durationSeconds: 8,
      resolution: '1080p',
    });
    expect(await video.poll(operationId)).toEqual({ status: 'running' });
    const done = await video.poll(operationId);
    if (done.status !== 'done') throw new Error('expected done');
    expect(Buffer.from(done.clip.data).subarray(4, 8).toString('ascii')).toBe('ftyp');
    expect(done.clip).toMatchObject({ durationSeconds: 8, width: 180, height: 320 });
  });

  it('rejects an unknown operation as terminal', async () => {
    await expect(createFakeVideo().poll('nope')).rejects.toMatchObject({ category: 'terminal' });
  });
});

describe('fake voice', () => {
  it('returns a WAV whose length matches the segment timings', async () => {
    const result = await createFakeVoice().synthesize({
      segments: ['one two three', 'four five'],
      voice: 'en-IN-Neural2-A',
      language: 'en',
    });
    expect(result.segmentStartsSeconds).toEqual([0, 1.25]);
    expect(result.durationSeconds).toBe(2.15);
    const bytes = Buffer.from(result.data);
    expect(bytes.subarray(0, 4).toString('ascii')).toBe('RIFF');
    const seconds = bytes.readUInt32LE(40) / bytes.readUInt32LE(28);
    expect(seconds).toBeCloseTo(result.durationSeconds, 2);
  });
});

describe('fake moderation', () => {
  it('flags only marked text', async () => {
    const moderation = createFakeModeration();
    expect(await moderation.checkText('hello')).toEqual({ allowed: true, flagged: [] });
    const blocked = await moderation.checkText('FAKE_BLOCK:violence');
    expect(blocked.allowed).toBe(false);
    expect(blocked.flagged[0]?.category).toBe('violence');
  });
});

describe('fake publisher', () => {
  it('prepares, publishes and never invents metrics', async () => {
    const publisher = createFakePublisher('instagram');
    const prepared = await publisher.prepare(account, { text: 'hi' });
    expect(await publisher.check(account, prepared)).toEqual({ state: 'ready' });
    const { platformPostId } = await publisher.publish(account, prepared, { text: 'hi' });
    const metrics = await publisher.metrics(account, platformPostId);
    expect(Object.keys(metrics)).toEqual(['fetchedAt']);
  });
});
