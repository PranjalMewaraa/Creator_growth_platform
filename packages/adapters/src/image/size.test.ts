import { describe, expect, it } from 'vitest';
import { solidPng } from '../fakes/media';
import { imageSize } from './size';

/** The smallest JPEG shape that matters here: markers, one segment, then SOF0. */
function jpeg(width: number, height: number): Uint8Array {
  const sof = [0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff];
  // APP0 (a 4 byte payload) sits before the frame header, so it has to be skipped by length.
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x06, 1, 2, 3, 4, ...sof, 0xff, 0xd9]);
}

describe('imageSize', () => {
  it('reads a PNG header', () => {
    expect(imageSize(solidPng(320, 180, [17, 34, 51]))).toEqual({ width: 320, height: 180 });
  });

  it('reads a JPEG frame header, skipping the segments before it', () => {
    expect(imageSize(jpeg(1080, 1350))).toEqual({ width: 1080, height: 1350 });
  });

  it('returns nothing for bytes that are neither, or are cut short', () => {
    expect(imageSize(new Uint8Array([1, 2, 3, 4]))).toBeUndefined();
    expect(imageSize(solidPng(8, 8, [0, 0, 0]).subarray(0, 16))).toBeUndefined();
    expect(imageSize(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x06, 1, 2, 3, 4]))).toBe(
      undefined,
    );
  });
});
