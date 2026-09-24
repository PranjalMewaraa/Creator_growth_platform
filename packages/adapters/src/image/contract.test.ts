import { isAdapterError, type ImageAdapter } from '@cgp/contracts';
import { describe, expect, it } from 'vitest';
import { imageSize } from './size';
import { IMAGE_MODEL_KEYS } from '../models';
import { createImageAdapters } from '../registry';

// One contract for every image adapter. Fakes always run; the real models run only with
// CGP_LIVE_PROVIDERS=1, because each picture costs about three rupees.
const live = process.env.CGP_LIVE_PROVIDERS === '1';
const project = process.env.GOOGLE_CLOUD_PROJECT ?? '';

const suites: [string, () => ImageAdapter[]][] = [
  ['fake', () => Object.values(createImageAdapters('fake'))],
];
if (live) {
  suites.push(['real', () => Object.values(createImageAdapters('real', { project }))]);
}

const request = { prompt: 'A cup of chai on a wooden table, morning light.', count: 1 };

describe.each(suites)('image adapter contract (%s)', (_mode, adapters) => {
  const all = adapters();

  it('has one adapter per configured model', () => {
    expect(all.map((a) => a.key).sort()).toEqual([...IMAGE_MODEL_KEYS].sort());
  });

  it.each(all.map((a) => [a.key, a] as const))(
    '%s returns a readable picture in the frame asked for',
    async (_key, adapter) => {
      const { images, usage } = await adapter.generate({ ...request, aspectRatio: '4:5' });
      expect(images).toHaveLength(1);
      const image = images[0];
      if (!image) throw new Error('expected an image');
      expect(image.data.byteLength).toBeGreaterThan(0);
      expect(imageSize(image.data)).toEqual({ width: image.width, height: image.height });
      // 4:5 to within a rounding step, whatever resolution the provider chose.
      expect(image.width / image.height).toBeCloseTo(0.8, 1);
      expect(usage.outputTokens).toBeGreaterThanOrEqual(0);
    },
    120_000,
  );

  it.each(all.map((a) => [a.key, a] as const))(
    '%s turns an abort into ABORTED',
    async (_key, adapter) => {
      const err: unknown = await adapter
        .generate({ ...request, aspectRatio: '1:1', signal: AbortSignal.abort() })
        .then(
          () => undefined,
          (e: unknown) => e,
        );
      expect(isAdapterError(err) && err.code).toBe('ABORTED');
    },
  );
});

describe('fake image', () => {
  const { 'gemini-flash-lite-image': fake } = createImageAdapters('fake');

  it('draws as many as asked for', async () => {
    const { images } = await fake.generate({ ...request, aspectRatio: '16:9', count: 3 });
    expect(images).toHaveLength(3);
    expect(new Set(images.map((i) => Buffer.from(i.data).toString('base64'))).size).toBe(3);
  });

  it('refuses to build real adapters without a project', () => {
    expect(() => createImageAdapters('real', { project: '' })).toThrow(/GCP project/);
  });
});
