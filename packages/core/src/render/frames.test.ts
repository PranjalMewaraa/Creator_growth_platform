import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ffmpegAvailable } from './ffmpeg';
import { sampleFrames } from './frames';

const options = { bin: process.env.FFMPEG_PATH ?? 'ffmpeg', preset: 'ultrafast' };
const available = await ffmpegAvailable(options);
const clip = new Uint8Array(
  readFileSync(fileURLToPath(new URL('../../../adapters/fixtures/fake-clip.mp4', import.meta.url))),
);

describe.skipIf(!available)('sampleFrames', () => {
  it('takes real JPEGs out of a clip, spread across its length', async () => {
    const frames = await sampleFrames(options, clip, 8);
    expect(frames).toHaveLength(3);
    for (const frame of frames) {
      expect(frame.mimeType).toBe('image/jpeg');
      // A JPEG starts with these three bytes; this is what a moderation adapter will read.
      expect([...frame.data.subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff]);
      expect(frame.data.byteLength).toBeGreaterThan(500);
    }
  }, 120_000);

  it('fails loudly when the bytes are not a clip, rather than passing nothing on', async () => {
    await expect(sampleFrames(options, new Uint8Array([1, 2, 3]), 8)).rejects.toThrow(
      /take a frame/,
    );
  }, 120_000);
});
