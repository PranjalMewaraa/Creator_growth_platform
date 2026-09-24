import type { TextLayerSpec } from '@cgp/contracts';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { flattenTextLayer, textLayerSchema, textLayerSvg } from './text-layer';

const block = {
  text: 'Cold brew, now in Jaipur',
  x: 0.08,
  y: 0.7,
  width: 0.84,
  fontSize: 0.08,
  font: 'Poppins' as const,
  bold: true,
  colour: '#FACC15',
  align: 'left' as const,
  plate: null,
};

const spec: TextLayerSpec = { version: 1, blocks: [block] };

/** A plain picture to draw on, in the frame a 4:5 post uses. */
async function picture(width = 1080, height = 1350): Promise<Uint8Array> {
  const png = await sharp({
    create: { width, height, channels: 3, background: '#1f2937' },
  })
    .png()
    .toBuffer();
  return new Uint8Array(png);
}

describe('textLayerSchema', () => {
  it('takes a spec the editor would send', () => {
    expect(textLayerSchema.safeParse(spec).success).toBe(true);
  });

  it('refuses a font outside the pinned set, so the render cannot differ', () => {
    const result = textLayerSchema.safeParse({
      version: 1,
      blocks: [{ ...block, font: 'Comic Sans MS' }],
    });
    expect(result.success).toBe(false);
  });

  it('refuses colours that are not hex, and sizes that cannot be read', () => {
    expect(
      textLayerSchema.safeParse({ version: 1, blocks: [{ ...block, colour: 'red' }] }).success,
    ).toBe(false);
    expect(
      textLayerSchema.safeParse({ version: 1, blocks: [{ ...block, fontSize: 0.5 }] }).success,
    ).toBe(false);
  });

  it('refuses an empty layer and a crowded one', () => {
    expect(textLayerSchema.safeParse({ version: 1, blocks: [] }).success).toBe(false);
    const five = Array.from({ length: 5 }, () => block);
    expect(textLayerSchema.safeParse({ version: 1, blocks: five }).success).toBe(false);
  });
});

describe('textLayerSvg', () => {
  it('wraps to the box, one line per text element', () => {
    const long = {
      ...block,
      text: 'Our cold brew now ships across Jaipur in small batches every morning',
      width: 0.4,
    };
    const svg = textLayerSvg({ version: 1, blocks: [long] }, 1080, 1350);
    const lines = svg.match(/<text /g) ?? [];
    expect(lines.length).toBeGreaterThan(2);
  });

  it('keeps a headline that fits on one line', () => {
    const svg = textLayerSvg({ version: 1, blocks: [{ ...block, fontSize: 0.03 }] }, 1080, 1350);
    expect(svg.match(/<text /g)).toHaveLength(1);
  });

  it('wraps the same headline once it is set large enough to overflow', () => {
    const svg = textLayerSvg(spec, 1080, 1350);
    expect((svg.match(/<text /g) ?? []).length).toBeGreaterThan(1);
  });

  it('breaks where the text says to', () => {
    const svg = textLayerSvg({ version: 1, blocks: [{ ...block, text: 'One\nTwo' }] }, 1080, 1350);
    expect(svg.match(/<text /g)).toHaveLength(2);
  });

  it('escapes markup in the headline rather than emitting it', () => {
    const svg = textLayerSvg(
      { version: 1, blocks: [{ ...block, text: 'A & <script>', fontSize: 0.03 }] },
      1080,
      1350,
    );
    expect(svg).toContain('A &amp; &lt;script&gt;');
    expect(svg).not.toContain('<script>');
  });

  it('draws a plate behind the words when one is asked for', () => {
    const withPlate = { ...block, plate: { colour: '#000000', opacity: 0.5 } };
    const svg = textLayerSvg({ version: 1, blocks: [withPlate] }, 1080, 1350);
    expect(svg).toContain('fill-opacity="0.5"');
  });

  it('places the anchor by the alignment asked for', () => {
    const right = textLayerSvg({ version: 1, blocks: [{ ...block, align: 'right' }] }, 1000, 1000);
    expect(right).toContain('text-anchor="end"');
    const centre = textLayerSvg(
      { version: 1, blocks: [{ ...block, align: 'center' }] },
      1000,
      1000,
    );
    expect(centre).toContain('text-anchor="middle"');
  });
});

describe('flattenTextLayer', () => {
  it('returns one JPEG at the size of the picture it drew on', async () => {
    const result = await flattenTextLayer(await picture(), spec);
    expect(result).toMatchObject({ mimeType: 'image/jpeg', width: 1080, height: 1350 });
    const meta = await sharp(result.data).metadata();
    expect(meta).toMatchObject({ format: 'jpeg', width: 1080, height: 1350 });
  });

  it('actually marks the picture where the text was placed', async () => {
    const plain = await picture(400, 500);
    const drawn = await flattenTextLayer(plain, {
      version: 1,
      blocks: [{ ...block, text: 'HELLO', y: 0.4, fontSize: 0.2, colour: '#FFFFFF' }],
    });
    // The background is one flat colour, so any light pixel is a letter.
    const { data, info } = await sharp(drawn.data).raw().toBuffer({ resolveWithObject: true });
    const light = [...data].filter((value, i) => i % info.channels === 0 && value > 200).length;
    expect(light).toBeGreaterThan(50);
  });

  it('renders the same spec the same way twice', async () => {
    const base = await picture(400, 500);
    const [one, two] = await Promise.all([
      flattenTextLayer(base, spec),
      flattenTextLayer(base, spec),
    ]);
    expect(Buffer.from(one.data).equals(Buffer.from(two.data))).toBe(true);
  });
});
