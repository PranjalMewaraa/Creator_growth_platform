import sharp from 'sharp';

/** Instagram's tallest feed frame, 4:5, at the width it displays. */
export const INSTAGRAM_FRAME = { width: 1080, height: 1350 } as const;

const HEX = /^#[0-9a-f]{6}$/i;

/**
 * The whole image, centred in the frame, with solid bars filling the rest: nothing is cropped.
 * Honours the camera's orientation tag, fills transparency with the bar colour, and returns a
 * JPEG, the only still format Instagram takes.
 */
export async function fitToFrame(
  data: Uint8Array,
  frame: { width: number; height: number },
  barColour: string,
): Promise<Uint8Array> {
  const background = HEX.test(barColour) ? barColour : '#000000';
  const output = await sharp(data)
    .rotate()
    .resize(frame.width, frame.height, { fit: 'contain', background })
    .flatten({ background })
    .jpeg({ quality: 90, mozjpeg: true })
    .toBuffer();
  return new Uint8Array(output);
}
