import sharp from 'sharp';

/** Instagram's feed frames at the width it displays: 4:5 portrait (the tallest) and 1:1. */
export const INSTAGRAM_FRAMES = {
  portrait: { width: 1080, height: 1350 },
  square: { width: 1080, height: 1080 },
} as const;

export type InstagramFrame = keyof typeof INSTAGRAM_FRAMES;

/** The default frame: the most feed space. */
export const INSTAGRAM_FRAME = INSTAGRAM_FRAMES.portrait;

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
