import type { MeteringRates } from '@cgp/contracts';
import { desc, lte } from 'drizzle-orm';
import { unwrap, type Database } from './client';
import { meteringRates } from './schema';

/** The rates in force now: the highest version already effective (FR-BL-01). */
export async function currentMeteringRates(db: Database): Promise<MeteringRates> {
  const [row] = await unwrap(db)
    .select()
    .from(meteringRates)
    .where(lte(meteringRates.effectiveFrom, new Date()))
    .orderBy(desc(meteringRates.version))
    .limit(1);
  if (!row) throw new Error('No metering rates are in force; run the seed');
  return { version: row.version, credits: row.credits };
}
