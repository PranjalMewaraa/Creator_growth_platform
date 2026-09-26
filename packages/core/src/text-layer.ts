import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Resvg } from '@resvg/resvg-js';
import {
  TARGET_PLATFORMS,
  TEXT_ALIGNMENTS,
  type ObjectStore,
  type OutputType,
  type RenditionView,
  type TargetPlatform,
  type TextAlign,
  type TextLayerBlock,
  type TextLayerSpec,
} from '@cgp/contracts';
import { jobs, outputs, saveRendition, scoped, type Database } from '@cgp/db';
import { create as createFont, type Font } from 'fontkit';
import sharp from 'sharp';
import { z } from 'zod';
import { BRAND_FONTS } from './brand-kit';
import type { InputIssue } from './generators/registry';
import { fontDir } from './render/fonts';

// The text layer (D12, invariant 12): a spec of vector text blocks, measured and wrapped with
// the same font files that rasterise it, composited over the picture the model drew.

/** The pinned font set. Nothing outside it can be named by a spec. */
const FONT_FILES: Record<string, { regular: string; bold: string }> = {
  Poppins: { regular: 'Poppins-Regular.ttf', bold: 'Poppins-Bold.ttf' },
  'Noto Sans Devanagari': {
    regular: 'NotoSansDevanagari-Regular.ttf',
    bold: 'NotoSansDevanagari-Bold.ttf',
  },
};

const HEX = /^#[0-9a-f]{6}$/i;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The output kinds a layer can be drawn on. Text output has nothing to draw on. */
const PICTURES: ReadonlySet<OutputType> = new Set(['image', 'thumbnail']);

const fraction = z.number().min(0).max(1);

const blockSchema = z.object({
  text: z.string().trim().min(1).max(200),
  x: fraction,
  y: fraction,
  width: z.number().min(0.05).max(1),
  // Under 1% of the height is unreadable; over 30% fits about three words.
  fontSize: z.number().min(0.01).max(0.3),
  font: z.enum(BRAND_FONTS),
  bold: z.boolean(),
  colour: z.string().regex(HEX, 'Colours are six digit hex, like #FACC15'),
  align: z.enum(TEXT_ALIGNMENTS),
  plate: z.object({ colour: z.string().regex(HEX), opacity: z.number().min(0).max(1) }).nullable(),
});

/** At most four blocks: a headline, a subline and two more is already a busy picture. */
export const textLayerSchema = z.object({
  version: z.literal(1),
  blocks: z.array(blockSchema).min(1).max(4),
});

const fonts = new Map<string, Font>();

function fontFile(family: string, bold: boolean): string {
  const files = FONT_FILES[family] ?? FONT_FILES.Poppins;
  if (!files) throw new Error('No fonts are installed');
  return bold ? files.bold : files.regular;
}

function loadFont(file: string): Font {
  const cached = fonts.get(file);
  if (cached) return cached;
  const font = createFont(readFileSync(join(fontDir(), file)));
  if ('fonts' in font) throw new Error(`${file} is a collection, not a single font`);
  fonts.set(file, font);
  return font;
}

/** The width of a string at a given size, from the font's own advances. */
function measure(font: Font, text: string, fontSize: number): number {
  return (font.layout(text).advanceWidth / font.unitsPerEm) * fontSize;
}

/**
 * Greedy wrapping to the block's width, measured with the font that will draw it, so the
 * lines the editor is told about are the lines that come out. A single word longer than the
 * box is left to overflow rather than broken mid word.
 */
export function wrapText(font: Font, text: string, fontSize: number, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const word of paragraph.trim().split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word;
      if (line && measure(font, candidate, fontSize) > maxWidth) {
        lines.push(line);
        line = word;
      } else {
        line = candidate;
      }
    }
    lines.push(line);
  }
  return lines;
}

const LINE_HEIGHT = 1.25;
/** Breathing room around the words when a plate is drawn behind them. */
const PLATE_PADDING = 0.4;

function escapeXml(text: string): string {
  return text.replace(
    /[<>&'"]/g,
    (char) =>
      ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[char] ?? char,
  );
}

function anchorFor(align: TextAlign): string {
  return align === 'left' ? 'start' : align === 'right' ? 'end' : 'middle';
}

function blockSvg(block: TextLayerBlock, width: number, height: number): string {
  const font = loadFont(fontFile(block.font, block.bold));
  const size = block.fontSize * height;
  const boxWidth = block.width * width;
  const lines = wrapText(font, block.text, size, boxWidth);
  const left = block.x * width;
  const top = block.y * height;
  const anchorX =
    left + (block.align === 'left' ? 0 : block.align === 'right' ? boxWidth : boxWidth / 2);
  const lineHeight = size * LINE_HEIGHT;

  const plate = block.plate
    ? `<rect x="${left - size * PLATE_PADDING}" y="${top - size * PLATE_PADDING}" ` +
      `width="${boxWidth + size * PLATE_PADDING * 2}" ` +
      `height="${lines.length * lineHeight + size * PLATE_PADDING * 2}" ` +
      `rx="${size * 0.3}" fill="${block.plate.colour}" fill-opacity="${block.plate.opacity}"/>`
    : '';

  // Each line is its own <text>: resvg does not lay out tspans the way a browser does.
  const text = lines
    .map((line, i) => {
      // The baseline sits about four fifths down the line box for these faces.
      const y = top + i * lineHeight + size * 0.8;
      return (
        `<text x="${anchorX}" y="${y}" font-family="${block.font}" ` +
        `font-size="${size}" font-weight="${block.bold ? 700 : 400}" ` +
        `fill="${block.colour}" text-anchor="${anchorFor(block.align)}" ` +
        `xml:space="preserve">${escapeXml(line)}</text>`
      );
    })
    .join('');

  return plate + text;
}

/** The layer on its own, as SVG. Exported so tests can read what will be drawn. */
export function textLayerSvg(spec: TextLayerSpec, width: number, height: number): string {
  const blocks = spec.blocks.map((block) => blockSvg(block, width, height)).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${blocks}</svg>`;
}

export type SaveTextLayerResult =
  | { ok: true; rendition: RenditionView }
  | { ok: false; reason: 'output_not_found' | 'not_a_picture' }
  | { ok: false; reason: 'invalid_input'; issues: InputIssue[] };

/**
 * Composites a layer over a generated picture and keeps it as that output's rendition for the
 * platform it was made for: one per output per platform, replaced whenever the spec changes.
 * The original output is never touched, so the layer can always be redone or removed.
 */
export async function saveTextLayer(
  deps: { db: Database; store: ObjectStore },
  workspaceId: string,
  outputId: string,
  rawSpec: unknown,
): Promise<SaveTextLayerResult> {
  if (!UUID.test(outputId)) return { ok: false, reason: 'output_not_found' };
  const ws = scoped(deps.db, workspaceId);
  const [output] = await ws.select(outputs, { where: (t, op) => op.eq(t.id, outputId), limit: 1 });
  if (!output) return { ok: false, reason: 'output_not_found' };
  if (!PICTURES.has(output.kind)) return { ok: false, reason: 'not_a_picture' };

  const parsed = textLayerSchema.safeParse(rawSpec);
  if (!parsed.success) {
    return {
      ok: false,
      reason: 'invalid_input',
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    };
  }

  const base = await deps.store.get(output.storageKey);
  const flattened = await flattenTextLayer(base, parsed.data);
  // The platform the picture was framed for, which is the platform this rendition is for.
  const platform = await platformOf(deps.db, workspaceId, output.jobId);
  const key = `${workspaceId}/renditions/${outputId}.${platform}.jpg`;
  const stored = await deps.store.put(key, flattened.data, flattened.mimeType);
  const row = await saveRendition(deps.db, workspaceId, {
    outputId,
    platform,
    spec: parsed.data,
    storageKey: stored.key,
  });
  return {
    ok: true,
    rendition: { id: row.id, outputId, url: stored.url, spec: parsed.data },
  };
}

/** What the job was made for. Instagram when it was made for nowhere in particular. */
async function platformOf(
  db: Database,
  workspaceId: string,
  jobId: string,
): Promise<TargetPlatform> {
  const [job] = await scoped(db, workspaceId).select(jobs, {
    where: (t, op) => op.eq(t.id, jobId),
    limit: 1,
  });
  const target = (job?.input as { targetPlatform?: unknown } | undefined)?.targetPlatform;
  return TARGET_PLATFORMS.find((platform) => platform === target) ?? 'instagram';
}

export interface FlattenedLayer {
  data: Uint8Array;
  mimeType: 'image/jpeg';
  width: number;
  height: number;
}

/**
 * Draws the layer over the picture and returns one flat JPEG, which is what a platform takes.
 * The text is rasterised at the picture's own size, so it stays crisp.
 */
export async function flattenTextLayer(
  base: Uint8Array,
  spec: TextLayerSpec,
): Promise<FlattenedLayer> {
  const image = sharp(base).rotate();
  const { width, height } = await image.metadata();
  if (!width || !height) throw new Error('The picture could not be read');

  const svg = textLayerSvg(spec, width, height);
  const layer = new Resvg(svg, {
    fitTo: { mode: 'width', value: width },
    font: {
      fontDirs: [fontDir()],
      // Only the pinned files, so a font installed on the machine can never change the output.
      loadSystemFonts: false,
      defaultFontFamily: 'Poppins',
    },
  })
    .render()
    .asPng();

  const output = await image
    .composite([{ input: Buffer.from(layer), top: 0, left: 0 }])
    .jpeg({ quality: 90, mozjpeg: true })
    .toBuffer();
  return { data: new Uint8Array(output), mimeType: 'image/jpeg', width, height };
}
