import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ffmpeg, type FfmpegOptions } from './ffmpeg';

/**
 * The render (plan section 4.6): scene clips normalised to one frame and frame rate,
 * concatenated, a music bed laid under them, the brand logo cornered, and out as H.264/AAC to
 * the Reels spec.
 *
 * Voiceover and burned in captions are the two pieces still to come (WP23, WP25). The shape
 * here leaves room for both: the audio graph already mixes, so a voice track joins it, and the
 * video graph already filters, so a subtitles pass joins that.
 */

/** Instagram Reels: vertical, 30fps, H.264 high, AAC. 720p is the tier the plan buys. */
export const REEL_FRAMES = {
  '720p': { width: 720, height: 1280 },
  '1080p': { width: 1080, height: 1920 },
} as const;

export type ReelResolution = keyof typeof REEL_FRAMES;

const FPS = 30;

/** Music sits under a voice without fighting it; with no voice yet this is simply quiet. */
const MUSIC_GAIN = 0.18;

/** The logo's height as a share of the frame, and its margin from the edge. */
const LOGO_HEIGHT = 0.06;
const LOGO_MARGIN = 0.04;

export interface ReelScene {
  /** An MP4 as the provider returned it; sizes and frame rates may differ between scenes. */
  data: Uint8Array;
  /** How long it runs, from the provider. The reel is cut to the sum of these. */
  durationSeconds: number;
}

export interface ReelRequest {
  scenes: ReelScene[];
  resolution: ReelResolution;
  /** A licensed track from the catalogue, laid under the whole reel. */
  music?: { data: Uint8Array } | undefined;
  /** The brand kit's logo, cornered bottom right. */
  logo?: { data: Uint8Array; mimeType: string } | undefined;
}

export interface Reel {
  data: Uint8Array;
  mimeType: 'video/mp4';
  width: number;
  height: number;
  durationSeconds: number;
}

/** Scale to fill the frame, crop the overflow, then pin the frame rate and pixel format. */
function normalise(index: number, width: number, height: number): string {
  return (
    `[${index}:v]scale=${width}:${height}:force_original_aspect_ratio=increase,` +
    `crop=${width}:${height},fps=${FPS},setsar=1,format=yuv420p[v${index}]`
  );
}

/**
 * How long the reel came out. ffmpeg reports `Duration:` for each input it read, so the number
 * that describes the output is the last `time=` it printed as it wrote.
 */
function writtenDuration(stderr: string): number {
  const times = [...stderr.matchAll(/time=(\d+):(\d+):(\d+\.\d+)/g)];
  const last = times.at(-1);
  if (!last) return 0;
  const [, h, m, s] = last;
  return Number((Number(h) * 3600 + Number(m) * 60 + Number(s)).toFixed(2));
}

/**
 * Builds one reel from the scenes given, in order. Everything happens in a temporary directory
 * that is removed afterwards, including on failure: clips are large and a worker renders all
 * day.
 */
export async function buildReel(options: FfmpegOptions, request: ReelRequest): Promise<Reel> {
  if (request.scenes.length === 0) throw new Error('A reel needs at least one scene');
  const { width, height } = REEL_FRAMES[request.resolution];
  const dir = await mkdtemp(join(tmpdir(), 'cgp-reel-'));

  try {
    // Input indexes are counted as they are added: ffmpeg numbers inputs in order, and some
    // of them carry flags of their own, so the position in the argument list says nothing.
    const inputs: string[] = [];
    let nextInput = 0;
    for (const [index, scene] of request.scenes.entries()) {
      const file = join(dir, `scene-${index}.mp4`);
      await writeFile(file, scene.data);
      inputs.push('-i', file);
      nextInput += 1;
    }

    const sceneCount = request.scenes.length;
    const total = request.scenes.reduce((sum, scene) => sum + scene.durationSeconds, 0);
    if (total <= 0) throw new Error('Scenes must say how long they run');
    let musicIndex: number | undefined;
    if (request.music) {
      const file = join(dir, 'music.audio');
      await writeFile(file, request.music.data);
      musicIndex = nextInput++;
      // The bed is looped and cut to the reel, so a short track still covers a long one.
      inputs.push('-stream_loop', '-1', '-i', file);
    }
    let logoIndex: number | undefined;
    if (request.logo) {
      const file = join(dir, 'logo.png');
      await writeFile(file, request.logo.data);
      logoIndex = nextInput++;
      inputs.push('-i', file);
    }

    const filters = request.scenes.map((_, index) => normalise(index, width, height));
    const chain = request.scenes.map((_, index) => `[v${index}]`).join('');
    filters.push(`${chain}concat=n=${sceneCount}:v=1:a=0[joined]`);

    let videoOut = '[joined]';
    if (logoIndex !== undefined) {
      const logoHeight = Math.round(height * LOGO_HEIGHT);
      const margin = Math.round(width * LOGO_MARGIN);
      filters.push(`[${logoIndex}:v]scale=-1:${logoHeight}[logo]`);
      filters.push(`[joined][logo]overlay=W-w-${margin}:H-h-${margin}[branded]`);
      videoOut = '[branded]';
    }

    const args = [...inputs, '-filter_complex'];
    const maps = ['-map', videoOut];
    if (musicIndex !== undefined) {
      filters.push(`[${musicIndex}:a]volume=${MUSIC_GAIN}[bed]`);
      // `-t`, not `-shortest`: a looped input has no end, and ffmpeg will happily encode the
      // bed for as long as it is left running. The scenes say how long the reel is.
      maps.push('-map', '[bed]', '-t', total.toFixed(3));
    }
    args.push(filters.join(';'), ...maps);

    const output = join(dir, 'reel.mp4');
    args.push(
      // The Reels spec: H.264 high, yuv420p, 30fps, AAC, and the index at the front so a
      // platform can start playing before the whole file has arrived.
      '-c:v',
      'libx264',
      '-profile:v',
      'high',
      '-preset',
      options.preset ?? 'medium',
      '-crf',
      '21',
      '-r',
      String(FPS),
      '-pix_fmt',
      'yuv420p',
      ...(musicIndex === undefined ? ['-an'] : ['-c:a', 'aac', '-b:a', '128k', '-ar', '44100']),
      '-movflags',
      '+faststart',
      output,
    );

    const stderr = await ffmpeg(options, 'render the reel', args);
    const data = new Uint8Array(await readFile(output));
    return {
      data,
      mimeType: 'video/mp4',
      width,
      height,
      durationSeconds: writtenDuration(stderr),
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
