import { describe, expect, it } from 'vitest';
import { editDistance, editRate } from './edit-distance';
import { EVAL_INTENTS } from './intents';
import type { EvalResult } from './run';
import { blindPairs, renderBlindHtml, scoreEval } from './score';

function result(id: string, compiled: string, raw: string): EvalResult {
  const intent = EVAL_INTENTS.find((entry) => entry.id === id) ?? EVAL_INTENTS[0];
  if (!intent) throw new Error('no intents');
  const arm = (text: string) => ({ text, prompt: 'p', elapsedMs: 1, outputTokens: 1 });
  return {
    intent,
    compiled: arm(compiled),
    raw: arm(raw),
    compiledPromptId: '00000000-0000-4000-8000-000000000000',
    fallbackUsed: false,
  };
}

describe('the evaluation set', () => {
  it('is twenty intents with unique ids, across the text output types', () => {
    expect(EVAL_INTENTS).toHaveLength(20);
    expect(new Set(EVAL_INTENTS.map((intent) => intent.id)).size).toBe(20);
    for (const outputType of ['script', 'hook', 'caption']) {
      expect(EVAL_INTENTS.some((intent) => intent.outputType === outputType)).toBe(true);
    }
  });

  it('reads like a person typed it, not like a prompt', () => {
    // Nothing in the set should be doing the engine's job for it.
    for (const intent of EVAL_INTENTS) {
      expect(intent.text).not.toMatch(/tone:|write a|you are a|include the following/i);
      expect(intent.text.length).toBeLessThan(120);
    }
  });
});

describe('blind pairing', () => {
  const results = [result('cold-brew-delivery', 'COMPILED', 'RAW')];

  it('hides which side is which, and keeps the answer in the key', () => {
    const { pairs, key } = blindPairs(results);
    const pair = pairs[0];
    const entry = key[0];
    if (!pair || !entry) throw new Error('expected a pair');
    expect([pair.a, pair.b].sort()).toEqual(['COMPILED', 'RAW']);
    expect(entry.compiledSide === 'a' ? pair.a : pair.b).toBe('COMPILED');
  });

  it('lays the same run out the same way twice, and differently on another seed', () => {
    const many = EVAL_INTENTS.slice(0, 12).map((intent) =>
      result(intent.id, `C:${intent.id}`, `R:${intent.id}`),
    );
    const sides = (seed: number) =>
      blindPairs(many, seed)
        .key.map((entry) => entry.compiledSide)
        .join('');
    expect(sides(20)).toBe(sides(20));
    expect(sides(20)).not.toBe(sides(7));
    // Both sides are used, so the judge cannot learn a position.
    expect(new Set(sides(20).split('')).size).toBe(2);
  });

  it('writes a page that never says which side came from the engine', () => {
    const blind = blindPairs(results);
    const html = renderBlindHtml(blind);
    expect(html).toContain('COMPILED');
    expect(html).toContain('RAW');
    expect(html.toLowerCase()).not.toContain('compiledside');
    expect(html).not.toContain('"compiled"');
  });

  it('escapes output rather than letting it into the page as markup', () => {
    const html = renderBlindHtml(blindPairs([result('thank-you', '<script>x</script>', 'fine')]));
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('scoring', () => {
  const key = [
    { intentId: 'a', compiledSide: 'a' as const },
    { intentId: 'b', compiledSide: 'b' as const },
    { intentId: 'c', compiledSide: 'a' as const },
    { intentId: 'd', compiledSide: 'b' as const },
  ];

  it('counts a win for whichever side the compiled output was on', () => {
    const score = scoreEval(key, { a: 'a', b: 'b', c: 'b', d: 'a' });
    expect(score).toMatchObject({ judged: 4, compiledWins: 2, rawWins: 2, compiledWinRate: 0.5 });
  });

  it('counts a tie as half, and leaves unjudged intents out', () => {
    const score = scoreEval(key, { a: 'a', b: 'tie' });
    expect(score).toMatchObject({ judged: 2, compiledWins: 1, ties: 1, compiledWinRate: 0.75 });
  });

  it('reports no lift when nothing was judged, rather than a flattering number', () => {
    expect(scoreEval(key, {})).toMatchObject({ judged: 0, compiledWinRate: 0 });
  });

  it('gives a clean sweep as a win rate of one', () => {
    expect(scoreEval(key, { a: 'a', b: 'b', c: 'a', d: 'b' }).compiledWinRate).toBe(1);
  });
});

describe('edit distance', () => {
  it('is zero for text kept as written', () => {
    expect(editDistance('same words', 'same words')).toBe(0);
    expect(editRate('same words', 'same words')).toBe(0);
  });

  it('counts each change once', () => {
    expect(editDistance('kitten', 'sitting')).toBe(3);
    expect(editDistance('', 'abc')).toBe(3);
    expect(editDistance('abc', '')).toBe(3);
  });

  it('reads as a share of the longer side, so cutting counts like adding', () => {
    expect(editRate('abcd', 'abcd efgh')).toBeCloseTo(5 / 9, 3);
    expect(editRate('abcd efgh', 'abcd')).toBeCloseTo(5 / 9, 3);
    expect(editRate('', '')).toBe(0);
  });

  it('measures a small edit as a small share', () => {
    const generated = 'Cold brew, now delivered across Jaipur the same morning.';
    const accepted = 'Cold brew, now delivered across Jaipur every morning.';
    expect(editRate(generated, accepted)).toBeLessThan(0.15);
  });
});
