import { randomUUID } from 'node:crypto';
import type { MeteringRates } from '@cgp/contracts';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { unwrap, wrap, type Database } from './client';
import { grant } from './ledger';
import { METERING_RATES_V1 } from './seed';
import { MIGRATIONS_FOLDER } from './migrate';
import * as schema from './schema';
import { createWorkspace } from './workspaces';

/**
 * A fresh in-memory Postgres (PGlite) with every migration applied. Real Postgres semantics
 * for constraints, triggers and transactions, but a single connection: lock contention
 * between concurrent writers needs a real Postgres.
 */
export async function createTestDatabase(): Promise<Database> {
  const client = new PGlite();
  const d = drizzle(client, { schema });
  await migrate(d, { migrationsFolder: MIGRATIONS_FOLDER });
  return wrap(d, () => client.close());
}

/** A workspace with an owner and the given balances, granted through the ledger. */
export async function createTestWorkspace(
  db: Database,
  { credits = 0, videoSeconds = 0, name = 'Test workspace' } = {},
): Promise<string> {
  const [owner] = await unwrap(db)
    .insert(schema.users)
    .values({ name: 'Test owner', email: `${randomUUID()}@example.com` })
    .returning();
  if (!owner) throw new Error('User insert returned no row');
  const workspace = await createWorkspace(db, { name, ownerUserId: owner.id });
  if (credits > 0) await grant(db, workspace.id, 'credits', credits);
  if (videoSeconds > 0) await grant(db, workspace.id, 'video_seconds', videoSeconds);
  return workspace.id;
}

export { METERING_RATES_V1 } from './seed';

/** Metering rates in force from now on, as the seed writes them. */
export async function insertMeteringRates(
  db: Database,
  rates: MeteringRates = METERING_RATES_V1,
): Promise<void> {
  await unwrap(db)
    .insert(schema.meteringRates)
    .values({ version: rates.version, credits: rates.credits })
    .onConflictDoNothing();
}
