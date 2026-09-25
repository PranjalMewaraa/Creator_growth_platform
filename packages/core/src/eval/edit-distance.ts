/**
 * How much of a generated output a creator changed before accepting it (WP20). The eval set
 * says which prompt a judge prefers; this says what the engine costs a creator in edits, on
 * real work, and it is the number the demo claim should rest on over time.
 */

/** Levenshtein distance, iterative with two rows: the strings here are captions, not novels. */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  let current = new Array<number>(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    current[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const substitution = (previous[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1);
      const deletion = (previous[j] ?? 0) + 1;
      const insertion = (current[j - 1] ?? 0) + 1;
      current[j] = Math.min(substitution, deletion, insertion);
    }
    [previous, current] = [current, previous];
  }
  return previous[b.length] ?? 0;
}

/**
 * The share of the output that changed, 0 when it was posted as written and 1 when nothing of
 * it survived. Normalised by the longer side, so adding a paragraph counts as much as cutting
 * one.
 */
export function editRate(generated: string, accepted: string): number {
  const longest = Math.max(generated.length, accepted.length);
  if (longest === 0) return 0;
  return Number((editDistance(generated, accepted) / longest).toFixed(4));
}
