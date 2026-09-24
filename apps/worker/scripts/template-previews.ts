// Fills the template gallery with real output (WP19, invariant 14): every template is run
// through its own generator, and what comes back becomes its preview.
//
//   pnpm --filter @cgp/worker previews <workspace id> [--force] [--only slug,slug]
//
// The credits come out of that workspace, and with PROVIDERS=real the provider calls are real
// and cost money: about INR 3 per image or thumbnail template, paise for the text ones. Run it
// with PROVIDERS=fake first to check the pipeline without spending anything.
import { baseEnvSchema, createLogger, loadRootEnvFile, parseEnv } from '@cgp/config';
import { createProviders } from '@cgp/adapters';
import { buildTemplatePreviews, generators } from '@cgp/core';
import { createDatabase } from '@cgp/db';

loadRootEnvFile();
const env = parseEnv(baseEnvSchema);
const log = createLogger({ service: 'previews', level: env.LOG_LEVEL });

const args = process.argv.slice(2);
const [workspaceId] = args.filter((arg) => !arg.startsWith('--'));
if (!workspaceId) throw new Error('Usage: previews <workspace id> [--force] [--only slug,slug]');
const force = args.includes('--force');
const onlyArg = args.find((arg) => arg.startsWith('--only'));
const only = onlyArg?.includes('=') ? onlyArg.split('=')[1]?.split(',') : undefined;

// No Redis: the pipeline runs each job itself and deliberately queues nothing, so a worker
// cannot pick the same job up and generate it a second time.
const db = createDatabase(env.DATABASE_URL, { max: 1 });
const providers = createProviders({ ...env, log });

try {
  const outcomes = await buildTemplatePreviews(
    {
      db,
      store: providers.store,
      moderation: providers.moderation,
      registry: generators,
      text: providers.text,
      image: providers.image,
      rewriters: providers.rewriters,
      log,
    },
    workspaceId,
    { force, ...(only ? { only } : {}) },
  );
  for (const outcome of outcomes) {
    log.info(
      outcome,
      `${outcome.slug}: ${outcome.status}${outcome.detail ? ` (${outcome.detail})` : ''}`,
    );
  }
  const made = outcomes.filter((outcome) => outcome.status === 'made').length;
  log.info({ made, total: outcomes.length }, 'previews done');
} finally {
  await db.close();
}
