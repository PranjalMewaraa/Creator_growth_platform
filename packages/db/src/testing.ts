import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { wrap, type Database } from './client';
import { MIGRATIONS_FOLDER } from './migrate';
import * as schema from './schema';

/**
 * A fresh in-memory Postgres (PGlite) with every migration applied. Real Postgres semantics
 * for constraints, triggers and transactions, but a single connection: lock contention
 * between concurrent writers still needs the docker Postgres.
 */
export async function createTestDatabase(): Promise<Database> {
  const client = new PGlite();
  const d = drizzle(client, { schema });
  await migrate(d, { migrationsFolder: MIGRATIONS_FOLDER });
  return wrap(d, () => client.close());
}
