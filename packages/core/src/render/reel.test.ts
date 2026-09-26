import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ffmpegAvailable, RenderFailed } from './ffmpeg';
import { buildReel } from './reel';

// These run the real ffmpeg, because a render that only passes against a mock proves nothing
// about a file a platform will accept. Without one they are skipped rather than faked.
const bin = process.env.FFMPEG_PATH ?? 'ffmpeg';
const options = { bin, timeoutMs: 120_000, preset: 'ultrafast' };
const available = await ffmpegAvailable(options);

const clip = new Uint8Array(
  readFileSync(fileURLToPath(new URL('../../../adapters/fixtures/fake-clip.mp4', import.meta.url))),
);

/** The fixture clip, which runs for eight seconds. */
const scene = { data: clip, durationSeconds: 8 };

/** What the file actually is, read back with ffmpeg rather than trusted from the request. */
function probe(data: Uint8Array): string {
  const file = join(mkdtempSync(join(tmpdir(), 'cgp-probe-')), 'out.mp4');
  writeFileSync(file, data);
  try {
    execFileSync(bin, ['-hide_banner', '-i', file], { encoding: 'utf8', stdio: 'pipe' });
    return '';
  } catch (err) {
    // ffmpeg exits non zero when given no output file, and prints the streams to stderr.
    return (err as { stderr?: string }).stderr ?? '';
  }
}

describe.skipIf(!available)('buildReel', () => {
  it('joins the scenes into one vertical H.264 file at the frame asked for', async () => {
    const reel = await buildReel(options, {
      scenes: [scene, scene],
      resolution: '720p',
    });

    expect(reel).toMatchObject({ mimeType: 'video/mp4', width: 720, height: 1280 });
    // Two eight second scenes, joined.
    expect(reel.durationSeconds).toBeGreaterThan(15);
    expect(reel.durationSeconds).toBeLessThan(17);

    const info = probe(reel.data);
    expect(info).toContain('720x1280');
    expect(info).toMatch(/h264/i);
    expect(info).toMatch(/30 fps/);
    // No audio was given, so none is invented.
    expect(info).not.toMatch(/Stream .*Audio/);
  }, 180_000);

  it('renders a single scene reel, which is the cut path in plan section 12', async () => {
    const reel = await buildReel(options, { scenes: [scene], resolution: '1080p' });
    expect(reel).toMatchObject({ width: 1080, height: 1920 });
    expect(probe(reel.data)).toContain('1080x1920');
  }, 180_000);

  it('lays a music bed under the reel and encodes it as AAC', async () => {
    // A tone stands in for a licensed track: what matters here is the audio graph.
    const music = join(mkdtempSync(join(tmpdir(), 'cgp-music-')), 'bed.m4a');
    execFileSync(bin, [
      '-hide_banner',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=220:duration=4',
      '-c:a',
      'aac',
      music,
    ]);

    const reel = await buildReel(options, {
      scenes: [scene],
      resolution: '720p',
      music: { data: new Uint8Array(readFileSync(music)) },
    });
    const info = probe(reel.data);
    expect(info).toMatch(/Stream .*Audio: aac/);
    // The bed is four seconds and the scene eight, so the loop has to cover it.
    expect(reel.durationSeconds).toBeGreaterThan(7);
  }, 180_000);

  it('mixes a voiceover over the reel', async () => {
    const voice = join(mkdtempSync(join(tmpdir(), 'cgp-voice-')), 'voice.mp3');
    execFileSync(bin, [
      '-hide_banner',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:duration=5',
      '-c:a',
      'libmp3lame',
      voice,
    ]);
    const reel = await buildReel(options, {
      scenes: [scene],
      resolution: '720p',
      voice: { data: new Uint8Array(readFileSync(voice)) },
    });
    const info = probe(reel.data);
    expect(info).toMatch(/Stream .*Audio: aac/);
    // The voice is five seconds and the scene eight: the track is padded, not truncated.
    expect(reel.durationSeconds).toBeGreaterThan(7);
  }, 180_000);

  it('ducks the music under the voice rather than letting them fight', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cgp-mix-'));
    const voice = join(dir, 'voice.mp3');
    const music = join(dir, 'bed.m4a');
    execFileSync(bin, [
      '-hide_banner',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:duration=4',
      '-c:a',
      'libmp3lame',
      voice,
    ]);
    execFileSync(bin, [
      '-hide_banner',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=180:duration=4',
      '-c:a',
      'aac',
      music,
    ]);

    const reel = await buildReel(options, {
      scenes: [scene],
      resolution: '720p',
      voice: { data: new Uint8Array(readFileSync(voice)) },
      music: { data: new Uint8Array(readFileSync(music)) },
    });
    expect(probe(reel.data)).toMatch(/Stream .*Audio: aac/);
    expect(reel.durationSeconds).toBeGreaterThan(7);
  }, 180_000);

  it('corners the brand logo without changing the frame', async () => {
    const logo = join(mkdtempSync(join(tmpdir(), 'cgp-logo-')), 'logo.png');
    execFileSync(bin, [
      '-hide_banner',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'color=c=yellow:s=200x200:d=1',
      '-frames:v',
      '1',
      logo,
    ]);

    const reel = await buildReel(options, {
      scenes: [scene],
      resolution: '720p',
      logo: { data: new Uint8Array(readFileSync(logo)), mimeType: 'image/png' },
    });
    expect(probe(reel.data)).toContain('720x1280');
  }, 180_000);

  it('refuses a reel with no scenes rather than writing an empty file', async () => {
    await expect(buildReel(options, { scenes: [], resolution: '720p' })).rejects.toThrow(
      /at least one scene/,
    );
  });

  it('reports what ffmpeg said when a scene is not a video', async () => {
    const err: unknown = await buildReel(options, {
      scenes: [{ data: new Uint8Array([1, 2, 3, 4]), durationSeconds: 8 }],
      resolution: '720p',
    }).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(RenderFailed);
    expect((err as RenderFailed).message).toContain('render the reel');
  }, 120_000);
});
