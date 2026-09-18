// One tiny real call per text model, to prove the Vertex wiring. Costs a fraction of a paisa.
// Usage: pnpm --filter @cgp/adapters smoke:text [model key ...]
import { loadRootEnvFile } from '@cgp/config';
import { isAdapterError } from '@cgp/contracts';
import { TEXT_MODEL_KEYS, TEXT_MODELS, type TextModelKey } from '../src/models';
import { createTextAdapters } from '../src/registry';

loadRootEnvFile();
const project = process.env.GOOGLE_CLOUD_PROJECT;
if (!project) throw new Error('GOOGLE_CLOUD_PROJECT is not set in .env');

const asked = process.argv.slice(2) as TextModelKey[];
const keys = asked.length > 0 ? asked : TEXT_MODEL_KEYS;
const adapters = createTextAdapters('real', { project });

let failed = false;
for (const key of keys) {
  const started = performance.now();
  try {
    const result = await adapters[key].generate({
      system: 'Answer in one short sentence.',
      prompt: 'Name one colour of the Indian flag.',
      maxOutputTokens: 256,
    });
    const ms = Math.round(performance.now() - started);
    console.log(`${key} (${TEXT_MODELS[key].model}) ${ms}ms`, result.finishReason, result.usage);
    console.log(`  ${result.text.trim()}`);
  } catch (err) {
    failed = true;
    const detail = isAdapterError(err) ? `${err.code} ${err.category}` : String(err);
    console.error(`${key} (${TEXT_MODELS[key].model}) failed: ${detail}`);
  }
}
process.exitCode = failed ? 1 : 0;
