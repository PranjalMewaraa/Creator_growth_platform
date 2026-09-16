import { baseEnvSchema, loadRootEnvFile, parseEnv } from '@cgp/config';
import { createDatabase } from '../client';
import { seedDemo } from '../seed';

loadRootEnvFile();
const { DATABASE_URL } = parseEnv(baseEnvSchema.pick({ DATABASE_URL: true }));
const ownerEmail = process.env.SEED_OWNER_EMAIL ?? 'owner@example.com';

const db = createDatabase(DATABASE_URL, { max: 1 });
try {
  const result = await seedDemo(db, { ownerEmail });
  console.log(
    result.skipped
      ? `Seed skipped: ${ownerEmail} already exists`
      : `Seeded workspaces ${result.workspaceIds.join(', ')} for ${ownerEmail}`,
  );
} finally {
  await db.close();
}
