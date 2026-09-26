/**
 * Captions (WP25). The script is already written and the voice has already said it, so the
 * timings come from the voice's own marks (invariant 13): nothing here transcribes a render.
 *
 * ASS rather than SRT, because ASS carries the styling with it and libass renders it the same
 * way on every machine, with the fonts we pin rather than the fonts a box happens to have.
 * The spike (docs/spikes/ffmpeg-captions.md) settled that this works, including Devanagari,
 * and left the tuning notes this file follows.
 */

export interface CaptionSegment {
  text: string;
  startSeconds: number;
  endSeconds: number;
}

export interface CaptionStyle {
  /** A family from the pinned set. Anything else would render differently per machine. */
  fontFamily: string;
  /** Cap height as a fraction of the frame height: 0.04 is about 51px on a 1280 tall reel. */
  fontSize: number;
  /** `&HBBGGRR`, which is what ASS wants, built from a hex colour by `assColour`. */
  colour: string;
  outlineColour: string;
  /** Outline width in pixels at 1080 wide; the spike found 5 too heavy, 3 to 4 right. */
  outline: number;
  /** How far up from the bottom the caption sits, as a fraction of the height. */
  marginV: number;
  bold: boolean;
}

export const DEFAULT_CAPTION_STYLE: CaptionStyle = {
  fontFamily: 'Poppins',
  fontSize: 0.042,
  colour: '#FFFFFF',
  outlineColour: '#000000',
  outline: 3.5,
  marginV: 0.27,
  bold: true,
};

/** ASS takes colours as `&HAABBGGRR`, backwards from hex and with alpha first. */
export function assColour(hex: string, alpha = 0): string {
  const clean = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((at) => clean.slice(at, at + 2).toUpperCase());
  return `&H${alpha.toString(16).padStart(2, '0').toUpperCase()}${b}${g}${r}`;
}

function timecode(seconds: number): string {
  const clamped = Math.max(0, seconds);
  const h = Math.floor(clamped / 3600);
  const m = Math.floor((clamped % 3600) / 60);
  const s = Math.floor(clamped % 60);
  const centis = Math.round((clamped - Math.floor(clamped)) * 100);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(
    Math.min(centis, 99),
  ).padStart(2, '0')}`;
}

/** Emoji are not rendered in colour by libass, so they are dropped rather than drawn as tofu. */
const EMOJI = /\p{Extended_Pictographic}(️|‍\p{Extended_Pictographic})*|\p{Regional_Indicator}{2}/gu;

/** A caption line as ASS wants it: one line, braces neutralised, emoji gone. */
export function assText(text: string): string {
  return text
    .replace(EMOJI, '')
    .replace(/\{/g, '(')
    .replace(/\}/g, ')')
    .replace(/\r?\n/g, '\\N')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The whole subtitle file. `PlayResX/Y` are the real frame size, so every margin below is in
 * the pixels the render actually has rather than in a notional coordinate space.
 */
export function buildAss(
  segments: CaptionSegment[],
  frame: { width: number; height: number },
  style: CaptionStyle = DEFAULT_CAPTION_STYLE,
): string {
  const fontSize = Math.round(style.fontSize * frame.height);
  // The spike measured its outline at 1080 wide; keep the same weight at any width.
  const outline = Number(((style.outline * frame.width) / 1080).toFixed(2));
  const marginV = Math.round(style.marginV * frame.height);
  const marginH = Math.round(frame.width * 0.08);

  const header = [
    '[Script Info]',
    'ScriptType: v4.00+',
    // 0 wraps into balanced lines, which is what the spike saw and what reads best.
    'WrapStyle: 0',
    'ScaledBorderAndShadow: yes',
    `PlayResX: ${frame.width}`,
    `PlayResY: ${frame.height}`,
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, OutlineColour, BackColour, Bold, Italic,' +
      ' Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow,' +
      ' Alignment, MarginL, MarginR, MarginV, Encoding',
    // Spacing 1 because the outline eats the gaps between words, which the spike noticed.
    `Style: Caption,${style.fontFamily},${fontSize},${assColour(style.colour)},` +
      `${assColour(style.outlineColour)},${assColour(style.outlineColour, 0x80)},` +
      `${style.bold ? -1 : 0},0,0,0,100,100,1,0,1,${outline},0,2,${marginH},${marginH},` +
      `${marginV},1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ];

  const events = segments
    .filter(
      (segment) => assText(segment.text).length > 0 && segment.endSeconds > segment.startSeconds,
    )
    .map(
      (segment) =>
        `Dialogue: 0,${timecode(segment.startSeconds)},${timecode(segment.endSeconds)},` +
        `Caption,,0,0,0,,${assText(segment.text)}`,
    );

  return [...header, ...events, ''].join('\n');
}

/**
 * Turns what the voice said into caption windows: each line runs until the next one starts,
 * and the last until the voice stops. No line is left on screen after the speech ends.
 */
export function captionsFromVoiceover(
  lines: string[],
  startsSeconds: number[],
  durationSeconds: number,
): CaptionSegment[] {
  return lines.map((text, i) => ({
    text,
    startSeconds: startsSeconds[i] ?? 0,
    endSeconds: startsSeconds[i + 1] ?? durationSeconds,
  }));
}
