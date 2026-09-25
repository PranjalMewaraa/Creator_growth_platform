import type { EvalResult } from './run';

// Blind comparison and the number it produces (WP20). The judge sees two outputs per intent
// with no labels and picks one; only the key says which side was compiled. Without the blind
// step the lift is an opinion about a prompt someone already believes in.

export interface BlindPair {
  intentId: string;
  outputType: string;
  /** What the creator typed. Shown, because judging without it is judging nothing. */
  intent: string;
  a: string;
  b: string;
}

export interface BlindKeyEntry {
  intentId: string;
  /** Which side held the compiled output. The judge never sees this file. */
  compiledSide: 'a' | 'b';
}

export interface Blind {
  pairs: BlindPair[];
  key: BlindKeyEntry[];
}

/** A seeded generator, so the same run lays the pairs out the same way twice. */
function rng(seed: number): () => number {
  let state = seed || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return ((state >>> 0) % 1000) / 1000;
  };
}

/** Lays each pair out with the compiled side chosen at random, and keeps the answer separately. */
export function blindPairs(results: EvalResult[], seed = 20): Blind {
  const next = rng(seed);
  const pairs: BlindPair[] = [];
  const key: BlindKeyEntry[] = [];
  for (const result of results) {
    const compiledSide = next() < 0.5 ? 'a' : 'b';
    pairs.push({
      intentId: result.intent.id,
      outputType: result.intent.outputType,
      intent: result.intent.text,
      a: compiledSide === 'a' ? result.compiled.text : result.raw.text,
      b: compiledSide === 'a' ? result.raw.text : result.compiled.text,
    });
    key.push({ intentId: result.intent.id, compiledSide });
  }
  return { pairs, key };
}

export type Verdict = 'a' | 'b' | 'tie';

export interface EvalScore {
  judged: number;
  compiledWins: number;
  rawWins: number;
  ties: number;
  /**
   * The share of judged pairs where the compiled prompt won, ties counted as half. 0.5 is no
   * lift at all: the engine did nothing a creator would notice.
   */
  compiledWinRate: number;
}

/** Scores the judge's picks against the key. Unjudged intents are left out, not assumed. */
export function scoreEval(key: BlindKeyEntry[], verdicts: Record<string, Verdict>): EvalScore {
  let compiledWins = 0;
  let rawWins = 0;
  let ties = 0;
  for (const entry of key) {
    const verdict = verdicts[entry.intentId];
    if (!verdict) continue;
    if (verdict === 'tie') ties += 1;
    else if (verdict === entry.compiledSide) compiledWins += 1;
    else rawWins += 1;
  }
  const judged = compiledWins + rawWins + ties;
  return {
    judged,
    compiledWins,
    rawWins,
    ties,
    compiledWinRate: judged === 0 ? 0 : Number(((compiledWins + ties / 2) / judged).toFixed(3)),
  };
}

const ESCAPE: Record<string, string> = {
  '<': '&lt;',
  '>': '&gt;',
  '&': '&amp;',
  '"': '&quot;',
};

function escapeHtml(text: string): string {
  return text.replace(/[<>&"]/g, (char) => ESCAPE[char] ?? char);
}

/**
 * One self contained page for the judge: both outputs side by side, no labels, no styling that
 * favours either, and a button that copies the verdicts back out as JSON for scoring.
 */
export function renderBlindHtml(blind: Blind, title = 'Evaluation set'): string {
  const rows = blind.pairs
    .map(
      (pair, i) => `
    <section class="pair">
      <h2>${i + 1}. ${escapeHtml(pair.outputType)}</h2>
      <p class="intent">Typed: ${escapeHtml(pair.intent)}</p>
      <div class="sides">
        <article><header>A</header><pre>${escapeHtml(pair.a)}</pre></article>
        <article><header>B</header><pre>${escapeHtml(pair.b)}</pre></article>
      </div>
      <div class="verdict" data-intent="${escapeHtml(pair.intentId)}">
        <label><input type="radio" name="${escapeHtml(pair.intentId)}" value="a"> A is better</label>
        <label><input type="radio" name="${escapeHtml(pair.intentId)}" value="b"> B is better</label>
        <label><input type="radio" name="${escapeHtml(pair.intentId)}" value="tie"> No difference</label>
      </div>
    </section>`,
    )
    .join('');

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>
  body { font: 15px/1.6 system-ui, sans-serif; max-width: 1100px; margin: 2rem auto; padding: 0 1rem; color: #18181b; }
  h1 { font-size: 1.4rem; }
  .pair { border-top: 1px solid #e4e4e7; padding: 1.5rem 0; }
  .intent { color: #52525b; font-style: italic; }
  .sides { display: grid; gap: 1rem; grid-template-columns: 1fr 1fr; }
  article { border: 1px solid #e4e4e7; border-radius: 8px; padding: 0.75rem 1rem; }
  header { font-weight: 600; color: #71717a; }
  pre { white-space: pre-wrap; font: inherit; margin: 0.5rem 0 0; }
  .verdict { display: flex; gap: 1.5rem; margin-top: 0.75rem; }
  footer { position: sticky; bottom: 0; background: #fff; border-top: 1px solid #e4e4e7; padding: 1rem 0; }
  button { font: inherit; padding: 0.5rem 1rem; border-radius: 8px; border: 1px solid #18181b; background: #18181b; color: #fff; cursor: pointer; }
</style></head>
<body>
  <h1>${escapeHtml(title)}</h1>
  <p>Two outputs per intent, in a random order. Pick the one you would post with less editing.
     Which side came from the engine is not in this file.</p>
  ${rows}
  <footer>
    <button id="copy">Copy verdicts</button>
    <span id="count"></span>
    <pre id="out"></pre>
  </footer>
  <script>
    const out = document.getElementById('out');
    function verdicts() {
      const picked = {};
      for (const group of document.querySelectorAll('.verdict')) {
        const chosen = group.querySelector('input:checked');
        if (chosen) picked[group.dataset.intent] = chosen.value;
      }
      return picked;
    }
    document.addEventListener('change', () => {
      document.getElementById('count').textContent =
        Object.keys(verdicts()).length + ' of ${blind.pairs.length} judged';
    });
    document.getElementById('copy').addEventListener('click', async () => {
      const text = JSON.stringify(verdicts(), null, 2);
      out.textContent = text;
      try { await navigator.clipboard.writeText(text); } catch {}
    });
  </script>
</body></html>`;
}
