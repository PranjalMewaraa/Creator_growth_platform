import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  assColour,
  assText,
  buildAss,
  captionsFromVoiceover,
  DEFAULT_CAPTION_STYLE,
} from './captions';
import { ffmpegAvailable } from './ffmpeg';
import { buildReel } from './reel';

const bin = process.env.FFMPEG_PATH ?? 'ffmpeg';
const options = { bin, timeoutMs: 180_000, preset: 'ultrafast' };
const available = await ffmpegAvailable(options);
const clip = new Uint8Array(
  readFileSync(fileURLToPath(new URL('../../../adapters/fixtures/fake-clip.mp4', import.meta.url))),
);
const frame = { width: 720, height: 1280 };

describe('caption timings', () => {
  it('runs each line until the next one starts, and the last until the voice stops', () => {
    const segments = captionsFromVoiceover(['One.', 'Two.', 'Three.'], [0, 2.5, 5.1], 7.8);
    expect(segments).toEqual([
      { text: 'One.', startSeconds: 0, endSeconds: 2.5 },
      { text: 'Two.', startSeconds: 2.5, endSeconds: 5.1 },
      { text: 'Three.', startSeconds: 5.1, endSeconds: 7.8 },
    ]);
  });
});

describe('the ASS file', () => {
  const segments = captionsFromVoiceover(['Cold brew, now in Jaipur.'], [0], 4);

  it('declares the real frame, so margins are in the pixels the render has', () => {
    const ass = buildAss(segments, frame);
    expect(ass).toContain('PlayResX: 720');
    expect(ass).toContain('PlayResY: 1280');
  });

  it('writes one dialogue line per segment, with centisecond timings', () => {
    const ass = buildAss(captionsFromVoiceover(['A.', 'B.'], [0, 1.25], 3.5), frame);
    expect(ass).toContain('Dialogue: 0,0:00:00.00,0:00:01.25,Caption,,0,0,0,,A.');
    expect(ass).toContain('Dialogue: 0,0:00:01.25,0:00:03.50,Caption,,0,0,0,,B.');
  });

  it('turns hex into the backwards colours ASS wants', () => {
    expect(assColour('#FACC15')).toBe('&H0015CCFA');
    expect(assColour('#000000', 0x80)).toBe('&H80000000');
  });

  it('drops emoji, which libass cannot draw in colour, and neutralises braces', () => {
    expect(assText('Cold brew 🎉 {now}')).toBe('Cold brew (now)');
    // A line break becomes ASS's own break, which is a backslash and a capital N.
    expect(assText('two\nlines')).toBe(String.raw`two\Nlines`);
  });

  it('leaves out a segment with nothing to say, or no time to say it in', () => {
    const ass = buildAss(
      [
        { text: '  ', startSeconds: 0, endSeconds: 2 },
        { text: 'Real.', startSeconds: 2, endSeconds: 2 },
      ],
      frame,
    );
    expect(ass).not.toContain('Dialogue:');
  });

  it('keeps the outline weight the spike settled on, whatever the frame', () => {
    // 3.5px at 1080 wide, scaled to the frame being rendered.
    expect(buildAss(segments, { width: 1080, height: 1920 })).toContain(',1,3.5,0,2,');
    expect(buildAss(segments, frame)).toContain(',1,2.33,0,2,');
  });
});

describe.skipIf(!available)('burning captions in', () => {
  it('draws them over the reel with the pinned fonts', async () => {
    const segments = captionsFromVoiceover(['Cold brew, now in Jaipur.'], [0], 8);
    const plain = await buildReel(options, {
      scenes: [{ data: clip, durationSeconds: 8 }],
      resolution: '720p',
    });
    const captioned = await buildReel(options, {
      scenes: [{ data: clip, durationSeconds: 8 }],
      resolution: '720p',
      captions: buildAss(segments, frame, { ...DEFAULT_CAPTION_STYLE, colour: '#FFFFFF' }),
    });

    // The caption band has to differ from the same band without captions.
    const band = (data: Uint8Array, name: string) => {
      const dir = mkdtempSync(join(tmpdir(), 'cgp-cap-'));
      const file = join(dir, `${name}.mp4`);
      writeFileSync(file, data);
      const out = join(dir, `${name}.png`);
      execFileSync(bin, [
        '-hide_banner',
        '-y',
        '-ss',
        '2',
        '-i',
        file,
        '-frames:v',
        '1',
        '-vf',
        'crop=720:300:0:860',
        out,
      ]);
      return readFileSync(out);
    };
    const withCaptions = band(captioned.data, 'captioned');
    const without = band(plain.data, 'plain');
    expect(withCaptions.equals(without)).toBe(false);
    // Text is the brightest thing in a dark band: the captioned frame is heavier.
    expect(withCaptions.byteLength).toBeGreaterThan(without.byteLength);
  }, 300_000);
});
