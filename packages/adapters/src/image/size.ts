// Providers return image bytes without saying how big the picture is, and the adapters package
// has no image library. Both formats state their size in the header, so reading it is enough.

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** SOF0 to SOF15: the frame headers that carry the size. The four listed are other segments. */
function isFrameHeader(marker: number): boolean {
  return marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
}

export interface ImageSize {
  width: number;
  height: number;
}

/** The pixel size of a PNG or JPEG, or nothing when the bytes are neither or are truncated. */
export function imageSize(data: Uint8Array): ImageSize | undefined {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

  if (PNG_SIGNATURE.every((byte, i) => data[i] === byte)) {
    // IHDR is always the first chunk: width and height are the two words after its header.
    if (data.byteLength < 24) return undefined;
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }

  if (data[0] === 0xff && data[1] === 0xd8) {
    let at = 2;
    while (at + 9 < data.byteLength) {
      if (data[at] !== 0xff) return undefined;
      const marker = data[at + 1] ?? 0;
      // Padding between segments, and the standalone markers that carry no length.
      if (marker === 0xff) {
        at += 1;
        continue;
      }
      if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd9)) {
        at += 2;
        continue;
      }
      if (isFrameHeader(marker)) {
        return { width: view.getUint16(at + 7), height: view.getUint16(at + 5) };
      }
      at += 2 + view.getUint16(at + 2);
    }
  }

  return undefined;
}
