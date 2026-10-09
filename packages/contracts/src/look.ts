/**
 * The look (WP37): camera, lens, focal length and aperture, each a controlled choice that maps
 * to the phrase a model answers to.
 *
 * Why a table rather than a free text field. Invariant 4 says the engine composes prompts, so
 * "shot on a classic 16mm film camera" has to be something the engine knows how to say, not
 * something the rewrite pass invents differently every time. A creator picks "16mm"; the same
 * words reach the model on every generation, and the compiled prompt disclosure shows them.
 *
 * The vocabulary is adapted from Open-Generative-AI (MIT), which had collected the phrasings
 * that these models actually respond to. What is deliberately not adapted is its habit of
 * appending "8K resolution, award-winning, ultra-detailed" to everything. That is filler from
 * an older generation of image models, and our own evaluation set says the compiled prompt
 * already wins while being the shorter of the two.
 */

export interface LookOption {
  id: string;
  /** What a person picks from a list. */
  label: string;
  /** What the model is told. */
  phrase: string;
}

export const CAMERAS: readonly LookOption[] = [
  { id: 'cine-digital', label: 'Full-frame digital', phrase: 'a full-frame digital cinema camera' },
  { id: 's35-digital', label: 'Super 35 digital', phrase: 'a Super 35 studio digital camera' },
  { id: 'film-16mm', label: '16mm film', phrase: 'a classic 16mm film camera' },
  { id: 'film-70mm', label: '70mm film', phrase: 'a grand format 70mm film camera' },
  {
    id: 'large-format',
    label: 'Large format digital',
    phrase: 'a large-format digital cinema camera',
  },
  { id: 'phone', label: 'Phone', phrase: 'a modern phone camera, handheld' },
];

export const LENSES: readonly LookOption[] = [
  { id: 'modern-prime', label: 'Modern prime', phrase: 'a modern prime lens' },
  { id: 'vintage-prime', label: 'Vintage prime', phrase: 'a vintage prime lens' },
  { id: 'anamorphic', label: 'Anamorphic', phrase: 'an anamorphic lens' },
  { id: 'macro', label: 'Macro', phrase: 'a macro lens' },
  { id: 'tilt', label: 'Tilt shift', phrase: 'a tilt-shift lens' },
  { id: 'diffusion', label: 'Soft diffusion', phrase: 'a prime lens behind a diffusion filter' },
];

/** Focal lengths, and what each one does to the frame. */
export const FOCAL_LENGTHS: readonly (LookOption & { mm: number })[] = [
  { id: '14mm', mm: 14, label: '14mm', phrase: 'a wide-angle perspective' },
  { id: '24mm', mm: 24, label: '24mm', phrase: 'a wide, dynamic perspective' },
  { id: '35mm', mm: 35, label: '35mm', phrase: 'a natural perspective' },
  { id: '50mm', mm: 50, label: '50mm', phrase: 'the perspective of the eye' },
  { id: '85mm', mm: 85, label: '85mm', phrase: 'a compressed portrait perspective' },
];

export const APERTURES: readonly LookOption[] = [
  { id: 'f1.4', label: 'f/1.4', phrase: 'wide open, the background falling away' },
  { id: 'f4', label: 'f/4', phrase: 'a balanced depth of field' },
  { id: 'f11', label: 'f/11', phrase: 'sharp from foreground to background' },
];

export const LOOK_KEYS = ['camera', 'lens', 'focalLength', 'aperture'] as const;
export type LookKey = (typeof LOOK_KEYS)[number];

export const LOOK_VOCABULARY: Record<LookKey, readonly LookOption[]> = {
  camera: CAMERAS,
  lens: LENSES,
  focalLength: FOCAL_LENGTHS,
  aperture: APERTURES,
};

export interface Look {
  camera?: string;
  lens?: string;
  focalLength?: string;
  aperture?: string;
}

function phraseOf(key: LookKey, id: string | undefined): string | undefined {
  if (!id) return undefined;
  return LOOK_VOCABULARY[key].find((option) => option.id === id)?.phrase;
}

/**
 * One sentence from whichever parts were chosen. Nothing is invented to fill a gap: a look
 * with only a camera says only what camera, because a default aperture nobody asked for is a
 * decision made on the creator's behalf and then hidden in a prompt they are told is theirs.
 */
export function composeLook(look: Look): string | undefined {
  const camera = phraseOf('camera', look.camera);
  const lens = phraseOf('lens', look.lens);
  const focal = FOCAL_LENGTHS.find((option) => option.id === look.focalLength);
  const aperture = phraseOf('aperture', look.aperture);

  const clauses: string[] = [];
  if (camera) clauses.push(`Shot on ${camera}`);
  if (lens && focal) clauses.push(`${camera ? 'with ' : 'Shot with '}${lens} at ${focal.mm}mm`);
  else if (lens) clauses.push(`${camera ? 'with ' : 'Shot with '}${lens}`);
  else if (focal) clauses.push(`${camera ? 'at ' : 'Shot at '}${focal.mm}mm`);
  if (focal) clauses.push(focal.phrase);
  if (aperture) clauses.push(aperture);

  if (clauses.length === 0) return undefined;
  return `${clauses.join(', ')}.`;
}

/** Whether an id is one this build knows, so an unknown one is refused rather than passed on. */
export function isLookOption(key: LookKey, id: string): boolean {
  return LOOK_VOCABULARY[key].some((option) => option.id === id);
}
