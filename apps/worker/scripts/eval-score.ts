// Scores a judged evaluation run (WP20): the verdicts against the key, which gives the one
// number the demo claim rests on.
//
//   pnpm --filter @cgp/worker eval:score evals/<stamp> verdicts.json
//
// The verdicts file is what the "Copy verdicts" button in blind.html produces.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { scoreEval, type BlindKeyEntry, type Verdict } from '@cgp/core';

const [dir, verdictsPath] = process.argv.slice(2);
if (!dir || !verdictsPath) throw new Error('Usage: eval:score <run directory> <verdicts.json>');

const key = JSON.parse(readFileSync(join(dir, 'key.json'), 'utf8')) as BlindKeyEntry[];
const verdicts = JSON.parse(readFileSync(verdictsPath, 'utf8')) as Record<string, Verdict>;
const score = scoreEval(key, verdicts);

const percent = (value: number) => `${(value * 100).toFixed(1)}%`;
console.log(`judged        ${score.judged} of ${key.length}`);
console.log(`compiled won  ${score.compiledWins}`);
console.log(`raw won       ${score.rawWins}`);
console.log(`no difference ${score.ties}`);
console.log(`win rate      ${percent(score.compiledWinRate)} (50% is no lift at all)`);
