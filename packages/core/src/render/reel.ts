import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ffmpeg, type FfmpegOptions } from './ffmpeg';
import { fontDir } from './fonts';

/**
 * The render (plan section 4.6): scene clips normalised to one frame and frame rate,
 * concatenated, a music bed laid under them, the brand logo cornered, and out as H.264/AAC to
 * the Reels spec.
 *
 * Voiceover and burned in captions are the two pieces still to come (WP23, WP25). The shape
 * here leaves room for both: the audio graph already mixes, so a voice track joins it, and the
 * video graph already filters, so a subtitles pass joins that.
 */

/** Reels and feed posts, 30fps, H.264 high, AAC. 720p/1080p is the tier the plan buys; the
 *  `-16:9` keys are the same two tiers turned landscape, for a video asked to film that way
 *  (WP66) — additive, so a reel already keyed by plain '720p'/'1080p' keeps meaning vertical. */
export const REEL_FRAMES = {
  '720p': { width: 720, height: 1280 },
  '1080p': { width: 1080, height: 1920 },
  '720p-16:9': { width: 1280, height: 720 },
  '1080p-16:9': { width: 1920, height: 1080 },
} as const;

export type ReelResolution = keyof typeof REEL_FRAMES;

const FPS = 30;

/** Music with nothing over it. */
const MUSIC_GAIN = 0.18;
/** Music under a voice: quieter still, and ducked further while the voice is actually speaking. */
const MUSIC_UNDER_VOICE = 0.1;

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
  /** The voiceover, over the top. Music ducks under it while it speaks. */
  voice?: { data: Uint8Array } | undefined;
  /** The brand kit's logo, cornered bottom right. */
  logo?: { data: Uint8Array; mimeType: string } | undefined;
  /** Burned in captions as ASS, timed by the voice (invariant 13, WP25). */
  captions?: string | undefined;
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
    let voiceIndex: number | undefined;
    if (request.voice) {
      const file = join(dir, 'voice.mp3');
      await writeFile(file, request.voice.data);
      voiceIndex = nextInput++;
      inputs.push('-i', file);
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
    if (request.captions) {
      // libass, with the fonts we pin rather than the fonts the machine happens to have. The
      // file is named relative to the working directory, because a Windows path inside a
      // filtergraph has to be escaped twice over and is not worth the risk.
      await writeFile(join(dir, 'captions.ass'), request.captions, 'utf8');
      // The fonts are copied in beside the file rather than named by absolute path: a colon
      // separates filter options, so a Windows drive letter needs escaping, and the escaping
      // that survives the shell, ffmpeg's parser and libass is not the same in all three. A
      // relative name has none of that, and the copy is under a megabyte.
      await cp(fontDir(), join(dir, 'fonts'), { recursive: true });
      filters.push('[joined]subtitles=captions.ass:fontsdir=fonts[captioned]');
      videoOut = '[captioned]';
    }
    if (logoIndex !== undefined) {
      const logoHeight = Math.round(height * LOGO_HEIGHT);
      const margin = Math.round(width * LOGO_MARGIN);
      filters.push(`[${logoIndex}:v]scale=-1:${logoHeight}[logo]`);
      filters.push(`${videoOut}[logo]overlay=W-w-${margin}:H-h-${margin}[branded]`);
      videoOut = '[branded]';
    }

    const args = [...inputs, '-filter_complex'];
    const maps = ['-map', videoOut];
    // The audio graph: a bed, a voice, or a bed ducked under a voice.
    if (musicIndex !== undefined && voiceIndex !== undefined) {
      // The voice is used twice, once as what you hear and once as the key that ducks the
      // bed, and a filter output can only be consumed once: hence the split.
      filters.push(`[${voiceIndex}:a]aresample=44100,apad,asplit=2[voice][key]`);
      filters.push(`[${musicIndex}:a]aresample=44100,volume=${MUSIC_UNDER_VOICE}[bedraw]`);
      // Ducking proper: the bed drops while the voice speaks and recovers when it stops.
      filters.push(
        `[bedraw][key]sidechaincompress=threshold=0.05:ratio=8:attack=20:release=400[ducked]`,
      );
      filters.push(`[ducked][voice]amix=inputs=2:duration=first:dropout_transition=0[mixed]`);
      maps.push('-map', '[mixed]', '-t', total.toFixed(3));
    } else if (voiceIndex !== undefined) {
      filters.push(`[${voiceIndex}:a]aresample=44100,apad[voice]`);
      maps.push('-map', '[voice]', '-t', total.toFixed(3));
    } else if (musicIndex !== undefined) {
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
      ...(musicIndex === undefined && voiceIndex === undefined
        ? ['-an']
        : ['-c:a', 'aac', '-b:a', '128k', '-ar', '44100']),
      '-movflags',
      '+faststart',
      output,
    );

    const stderr = await ffmpeg(options, 'render the reel', args, dir);
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
