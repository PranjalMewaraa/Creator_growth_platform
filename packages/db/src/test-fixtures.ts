import { randomUUID } from 'node:crypto';
import { unwrap, type Database } from './client';
import { users } from './schema';
import { createWorkspace } from './workspaces';

/** Package internal test helpers. Catalog writes here stand in for the seed. */
export async function makeWorkspace(db: Database, name: string) {
  const [owner] = await unwrap(db)
    .insert(users)
    .values({ email: `${randomUUID()}@example.com` })
    .returning();
  if (!owner) throw new Error('User insert returned no row');
  return createWorkspace(db, { name, ownerUserId: owner.id });
}

/** Resolves to the Postgres SQLSTATE the query failed with, or undefined if it succeeded. */
export async function sqlState(query: Promise<unknown>): Promise<string | undefined> {
  try {
    await query;
    return undefined;
  } catch (err) {
    const { code, cause } = err as { code?: string; cause?: { code?: string } };
    return code ?? cause?.code;
  }
}

export const SQLSTATE = {
  uniqueViolation: '23505',
  checkViolation: '23514',
  foreignKeyViolation: '23503',
  restrictViolation: '23001',
} as const;
