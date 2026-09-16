import type { ExtractTablesWithRelations } from 'drizzle-orm';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

export type Schema = typeof schema;

export type Drizzle = PgDatabase<PgQueryResultHKT, Schema, ExtractTablesWithRelations<Schema>>;

const handle = Symbol('drizzle');

/**
 * Opaque database handle. The raw query builder never leaves this package, so outside it
 * every query goes through scoped() or catalog() (invariant 1). Lint separately blocks
 * importing drizzle or a driver anywhere else.
 */
export interface Database {
  readonly [handle]: Drizzle;
  close(): Promise<void>;
}

export function wrap(drizzleDb: Drizzle, close: () => Promise<void>): Database {
  return { [handle]: drizzleDb, close };
}

/** Package internal. Not exported from the package entry point. */
export function unwrap(db: Database): Drizzle {
  return db[handle];
}

export function createDatabase(url: string, { max = 10 }: { max?: number } = {}): Database {
  const client = postgres(url, { max });
  return wrap(drizzle(client, { schema }), () => client.end());
}
