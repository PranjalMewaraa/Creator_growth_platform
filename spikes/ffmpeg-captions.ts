// WP5 spike: can ffmpeg burn clean captions onto a 9:16 reel with a pinned font stack,
// including Devanagari? Throwaway by design (plan section 11, week 1). The real render
// worker is WP24, and captions from the script are WP25.
//
//   node spikes/ffmpeg-captions.ts <work dir>
//
// Uses FFMPEG_PATH if set, else `ffmpeg` on PATH. Fonts come from infra/render-box/fonts.
// Writes captions.ass, reel.mp4, frame-*.png and ffmpeg.log into the work dir.

import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const workDir = resolve(process.argv[2] ?? 'spike-output');
const ffmpeg = process.env.FFMPEG_PATH ?? 'ffmpeg';
const FONTS = resolve('infra/render-box/fonts');

// A 24 second reel: three 8 second scenes. Timings stand in for TTS timepoints, which is how
// captions will come from the script rather than from transcribing the render (invariant 13).
interface Line {
  start: number;
  end: number;
  text: string;
  /** Per word durations in seconds for a word by word highlight. */
  karaoke?: number[];
}

const LINES: Line[] = [
  { start: 0, end: 2.8, text: 'Your content engine, in plain words.' },
  {
    start: 2.8,
    end: 5.6,
    text: 'Plan it. Make it. Post it.',
    karaoke: [0.4, 0.4, 0.45, 0.4, 0.45, 0.7],
  },
  {
    start: 5.6,
    end: 9,
    text: 'Type what you want. We handle the prompt, the format and the schedule.',
  },
  { start: 9, end: 12.5, text: 'अपनी बात सीधे शब्दों में लिखिए।' },
  { start: 12.5, end: 16, text: 'Reel ready hai, बस publish करो.' },
  { start: 16, end: 20, text: 'Instagram and LinkedIn, from one workspace.' },
  { start: 20, end: 24, text: 'Plans from ₹999 a month. 0123456789' },
];

const DURATION = 24;

/** ASS colours are &HAABBGGRR. */
const WHITE = '&H00FFFFFF';
const BLACK = '&H00000000';
const ACCENT = '&H001EC0FF'; // #FFC01E, the UI accent

function timestamp(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = (seconds % 60).toFixed(2).padStart(5, '0');
  return `${h}:${String(m).padStart(2, '0')}:${s}`;
}

function dialogue({ start, end, text, karaoke }: Line): string {
  if (!karaoke) return `Dialogue: 0,${timestamp(start)},${timestamp(end)},Caption,,0,0,0,,${text}`;
  // \k takes centiseconds: each word switches from the secondary colour to the primary.
  const words = text.split(' ');
  const body = words.map((word, i) => `{\\k${Math.round((karaoke[i] ?? 0.4) * 100)}}${word}`);
  return `Dialogue: 0,${timestamp(start)},${timestamp(end)},Karaoke,,0,0,0,,${body.join(' ')}`;
}

// PlayRes matches the frame, so every margin below is in real pixels. MarginV keeps captions
// above the bottom quarter, which Reels covers with the caption, audio and action buttons.
const ass = `[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Caption,Poppins SemiBold,64,${WHITE},${WHITE},${BLACK},&H80000000,0,0,0,0,100,100,0,0,1,5,0,2,110,110,480,1
Style: Karaoke,Poppins SemiBold,72,${ACCENT},${WHITE},${BLACK},&H80000000,0,0,0,0,100,100,0,0,1,5,0,2,110,110,480,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${LINES.map(dialogue).join('\n')}
`;

mkdirSync(join(workDir, 'fonts'), { recursive: true });
for (const font of readdirSync(FONTS).filter((f) => f.endsWith('.ttf'))) {
  copyFileSync(join(FONTS, font), join(workDir, 'fonts', font));
}
writeFileSync(join(workDir, 'captions.ass'), ass, 'utf8');

function run(args: string[]): { ms: number; log: string } {
  const started = Date.now();
  // cwd is the work dir so filter paths stay relative: a Windows drive colon breaks filter syntax.
  const result = spawnSync(ffmpeg, args, {
    cwd: workDir,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`ffmpeg exited ${result.status}:\n${result.stderr.slice(-3000)}`);
  return { ms: Date.now() - started, log: result.stderr };
}

// Busy colour bars under the text are a harder legibility test than a flat background.
const render = run([
  '-y',
  '-hide_banner',
  '-loglevel',
  'verbose',
  '-f',
  'lavfi',
  '-i',
  `testsrc2=s=1080x1920:r=30:d=${DURATION}`,
  '-f',
  'lavfi',
  '-i',
  'anullsrc=r=48000:cl=stereo',
  '-vf',
  'subtitles=captions.ass:fontsdir=fonts',
  '-c:v',
  'libx264',
  '-preset',
  'medium',
  '-crf',
  '20',
  '-profile:v',
  'high',
  '-pix_fmt',
  'yuv420p',
  '-c:a',
  'aac',
  '-b:a',
  '128k',
  '-shortest',
  '-movflags',
  '+faststart',
  'reel.mp4',
]);
writeFileSync(join(workDir, 'ffmpeg.log'), render.log, 'utf8');
console.log(`Rendered ${DURATION}s 1080x1920 reel in ${(render.ms / 1000).toFixed(1)}s`);

// Which fonts libass actually picked, per requested face. This is the font stack answer.
const fontLines = [
  ...new Set(
    render.log
      .split('\n')
      .filter((l) => /fontselect|glyph not found|font/i.test(l) && /libass|fontselect/i.test(l)),
  ),
];
console.log(
  fontLines.length ? fontLines.slice(0, 12).join('\n') : 'No libass font lines in the log',
);

// One still per caption, mid line, for visual inspection.
LINES.forEach((line, i) => {
  run([
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    '-ss',
    String((line.start + line.end) / 2),
    '-i',
    'reel.mp4',
    '-frames:v',
    '1',
    `frame-${i + 1}.png`,
  ]);
});
console.log(`Wrote ${LINES.length} frames to ${workDir}`);
