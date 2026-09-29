// Calendar history for a demo workspace (plan section 15, week 8 seed data).
//
//   pnpm --filter @cgp/worker seed:history <workspace id> [--weeks=6] [--per-week=4] [--clear]
//
// Writes finished posts into the past so the Calendar has weeks to scroll back through. It
// spends nothing and calls no provider: these are records of posts, not posts. Nothing is
// enqueued either, because a publish job dated last Tuesday is one the dispatcher would treat
// as overdue and try to send.
//
// Seeded posts never appear in Insights. They never reached a platform, so no platform can
// report on them, and showing them with empty metrics would imply one was asked.
import { baseEnvSchema, createLogger, loadRootEnvFile, parseEnv } from '@cgp/config';
import { clearHistory, createDatabase, scoped, seedHistory } from '@cgp/db';

loadRootEnvFile();
const env = parseEnv(baseEnvSchema);
const log = createLogger({ service: 'seed-history', level: env.LOG_LEVEL });

const args = process.argv.slice(2);
const [workspaceId] = args.filter((arg) => !arg.startsWith('--'));
if (!workspaceId) {
  throw new Error('Usage: seed:history <workspace id> [--weeks=6] [--per-week=4] [--clear]');
}
const number = (name: string, fallback: number) => {
  const found = args.find((arg) => arg.startsWith(`--${name}=`))?.split('=')[1];
  const value = found ? Number(found) : fallback;
  if (!Number.isFinite(value) || value <= 0) throw new Error(`--${name} must be a positive number`);
  return value;
};

const db = createDatabase(env.DATABASE_URL);

try {
  const workspace = await scoped(db, workspaceId).workspace();
  if (!workspace) throw new Error(`No workspace ${workspaceId}`);

  if (args.includes('--clear')) {
    const removed = await clearHistory(db, workspaceId);
    log.info({ removed }, 'seeded history removed');
  } else {
    const result = await seedHistory(db, workspaceId, {
      weeks: number('weeks', 6),
      perWeek: number('per-week', 4),
      timezone: workspace.timezone,
    });
    log.info(
      {
        workspace: workspace.name,
        publications: result.publications,
        targets: result.targets,
        from: result.from.toISOString().slice(0, 10),
      },
      'calendar history seeded',
    );
  }
} finally {
  await db.close();
}
