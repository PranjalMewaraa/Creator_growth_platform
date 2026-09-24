/**
 * Invariant 12: text on an image is a vector layer composited over it, never drawn by the
 * image model. The spec is stored as JSON and flattened with the same font files the editor
 * previews with, so what is saved is what was seen.
 *
 * Every measurement is a fraction of the picture, never a pixel, so one spec renders at any
 * size: the same headline works on a 1080x1350 post and a thumbnail twice that.
 */

export const TEXT_ALIGNMENTS = ['left', 'center', 'right'] as const;

export type TextAlign = (typeof TEXT_ALIGNMENTS)[number];

export interface TextPlate {
  colour: string;
  /** 0 to 1. A plate keeps words readable over a busy picture. */
  opacity: number;
}

export interface TextLayerBlock {
  text: string;
  /** The text box, as fractions of the width and height. */
  x: number;
  y: number;
  width: number;
  /** Cap height as a fraction of the picture's height. */
  fontSize: number;
  /** One of the brand kit's fonts. */
  font: string;
  bold: boolean;
  colour: string;
  align: TextAlign;
  plate: TextPlate | null;
}

export interface TextLayerSpec {
  version: 1;
  blocks: TextLayerBlock[];
}

/** What a flattened layer is stored as: the spec that made it, and where the picture went. */
export interface RenditionView {
  id: string;
  outputId: string;
  url: string;
  spec: TextLayerSpec;
}
