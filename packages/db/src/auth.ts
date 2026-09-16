import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { unwrap, type Database } from './client';
import { accounts, sessions, users, verifications } from './schema';

/**
 * Database access for the auth library, built here so drizzle stays inside this package
 * (plan section 18). Identity tables are written only through this adapter (A11).
 */
export function authDatabaseAdapter(db: Database) {
  return drizzleAdapter(unwrap(db), {
    provider: 'pg',
    schema: { user: users, session: sessions, account: accounts, verification: verifications },
  });
}
