// The evaluation set (WP20). Runs every intent twice through the same model, once from the
// compiled prompt and once from the words as typed, and writes a blind side by side page for
// a person to judge.
//
//   pnpm --filter @cgp/worker eval <workspace id> [--only id,id]
//   pnpm --filter @cgp/worker eval:score <run directory> <verdicts.json>
//
// With PROVIDERS=real this costs about a rupee: forty short text calls. Nothing is charged to
// the workspace and no output is stored, because an eval run is research, not the creator's
// work. The run directory holds results.json, blind.html and key.json; the key says which side
// was compiled, so judge from blind.html before opening it.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { baseEnvSchema, createLogger, loadRootEnvFile, parseEnv } from '@cgp/config';
import { createProviders } from '@cgp/adapters';
import { blindPairs, renderBlindHtml, runEvalSet } from '@cgp/core';
import { createDatabase } from '@cgp/db';

loadRootEnvFile();
const env = parseEnv(baseEnvSchema);
const log = createLogger({ service: 'eval', level: env.LOG_LEVEL });

const args = process.argv.slice(2);
const [workspaceId] = args.filter((arg) => !arg.startsWith('--'));
if (!workspaceId) throw new Error('Usage: eval <workspace id> [--only id,id]');
const onlyArg = args.find((arg) => arg.startsWith('--only'));
const only = onlyArg?.includes('=') ? onlyArg.split('=')[1]?.split(',') : undefined;

const db = createDatabase(env.DATABASE_URL, { max: 1 });
const providers = createProviders({ ...env, log });

try {
  const { results, failures } = await runEvalSet(
    {
      db,
      // Both arms on the workhorse model, which is what captions and hooks run on.
      adapter: providers.text['gemini-flash-lite'],
      rewriters: providers.rewriters,
      log,
    },
    workspaceId,
    { ...(only ? { only } : {}) },
  );

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const dir = join(process.cwd(), '..', '..', 'evals', stamp);
  mkdirSync(dir, { recursive: true });
  const blind = blindPairs(results);
  writeFileSync(join(dir, 'results.json'), JSON.stringify(results, null, 2));
  writeFileSync(join(dir, 'key.json'), JSON.stringify(blind.key, null, 2));
  writeFileSync(join(dir, 'blind.html'), renderBlindHtml(blind, `Evaluation set ${stamp}`));

  if (failures.length > 0)
    writeFileSync(join(dir, 'failures.json'), JSON.stringify(failures, null, 2));
  const fellBack = results.filter((result) => result.fallbackUsed).length;
  log.info(
    { dir, intents: results.length, failed: failures.length, fellBack, providers: env.PROVIDERS },
    'eval run written; judge blind.html, then score the verdicts against key.json',
  );
} finally {
  await db.close();
}
