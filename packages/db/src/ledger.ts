import type { Currency } from '@cgp/contracts';
import { eq, sql } from 'drizzle-orm';
import { unwrap, type Database, type Drizzle } from './client';
import { creditLedger, workspaces } from './schema';

const BALANCE = {
  credits: 'creditBalance',
  video_seconds: 'videoSecondsBalance',
} as const satisfies Record<Currency, keyof typeof workspaces.$inferSelect>;

/**
 * Writes a ledger entry and moves the cached balance in the same transaction (invariant 6).
 * The workspace row is locked first so concurrent writers serialise.
 */
export async function applyLedgerEntry(
  tx: Drizzle,
  entry: typeof creditLedger.$inferInsert,
): Promise<void> {
  const balance = BALANCE[entry.currency];
  await tx
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(eq(workspaces.id, entry.workspaceId))
    .for('update');
  await tx.insert(creditLedger).values(entry);
  await tx
    .update(workspaces)
    .set({ [balance]: sql`${workspaces[balance]} + ${entry.delta}` })
    .where(eq(workspaces.id, entry.workspaceId));
}

export function grantIn(tx: Drizzle, workspaceId: string, currency: Currency, amount: number) {
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new Error(`Grant must be a positive whole number, got ${amount}`);
  }
  return applyLedgerEntry(tx, { workspaceId, currency, delta: amount, reason: 'grant' });
}

/** Seed and admin only: the demo has no checkout, so credits arrive by grant (plan section 3). */
export function grant(
  db: Database,
  workspaceId: string,
  currency: Currency,
  amount: number,
): Promise<void> {
  return unwrap(db).transaction((tx) => grantIn(tx, workspaceId, currency, amount));
}
