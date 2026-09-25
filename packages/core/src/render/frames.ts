import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { MediaBytes } from '@cgp/contracts';
import { ffmpeg, type FfmpegOptions } from './ffmpeg';

/**
 * Stills taken out of a clip, so it can be moderated (plan section 6: text, image and sampled
 * frames). An image checker takes images; handing it an MP4 fails, which fails the job closed,
 * which is how every video job died until this existed.
 */

/** Where in the clip the frames come from, as fractions of its length. */
const SAMPLE_AT = [0.1, 0.5, 0.9];

export async function sampleFrames(
  options: FfmpegOptions,
  clip: Uint8Array,
  durationSeconds: number,
): Promise<MediaBytes[]> {
  const dir = await mkdtemp(join(tmpdir(), 'cgp-frames-'));
  try {
    const source = join(dir, 'clip.mp4');
    await writeFile(source, clip);
    const frames: MediaBytes[] = [];
    for (const [index, at] of SAMPLE_AT.entries()) {
      const file = join(dir, `frame-${index}.jpg`);
      // Seeking before the input is the fast path: ffmpeg jumps rather than decoding to there.
      await ffmpeg(options, 'take a frame from the clip', [
        '-ss',
        (Math.max(durationSeconds, 1) * at).toFixed(2),
        '-i',
        source,
        '-frames:v',
        '1',
        '-q:v',
        '4',
        file,
      ]);
      frames.push({ data: new Uint8Array(await readFile(file)), mimeType: 'image/jpeg' });
    }
    return frames;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
