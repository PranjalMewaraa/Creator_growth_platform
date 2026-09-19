import type { CSSProperties } from 'react';

/** Neon gradients in the art's palette, used when a slot has no image yet. */
const FALLBACKS = [
  'radial-gradient(80% 70% at 30% 20%, #f472b6 0%, transparent 60%), radial-gradient(90% 80% at 80% 90%, #7c3aed 0%, transparent 65%), #1e1033',
  'radial-gradient(80% 70% at 70% 25%, #22d3ee 0%, transparent 60%), radial-gradient(90% 80% at 20% 90%, #6d28d9 0%, transparent 65%), #0b1630',
  'radial-gradient(80% 70% at 30% 30%, #fb923c 0%, transparent 60%), radial-gradient(90% 80% at 80% 80%, #db2777 0%, transparent 65%), #2a0f1f',
  'radial-gradient(80% 70% at 60% 20%, #a78bfa 0%, transparent 60%), radial-gradient(90% 80% at 30% 90%, #0ea5e9 0%, transparent 65%), #10132b',
  'radial-gradient(80% 70% at 40% 25%, #facc15 0%, transparent 55%), radial-gradient(90% 80% at 80% 85%, #e11d48 0%, transparent 65%), #25110f',
  'radial-gradient(80% 70% at 70% 30%, #34d399 0%, transparent 55%), radial-gradient(90% 80% at 20% 85%, #7c3aed 0%, transparent 65%), #0d1b1f',
];

/** The art for slot `index`: an uploaded image when there is one, else a gradient. */
export function artStyle(index: number, art: readonly string[]): CSSProperties {
  const image = art.length > 0 ? art[index % art.length] : undefined;
  if (image) {
    return {
      backgroundImage: `url("${image}")`,
      backgroundSize: 'cover',
      backgroundPosition: 'center',
    };
  }
  return { background: FALLBACKS[index % FALLBACKS.length] };
}
