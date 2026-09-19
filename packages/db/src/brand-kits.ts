import { desc, eq, sql } from 'drizzle-orm';
import { unwrap, type Database } from './client';
import { brandKits } from './schema';

export type BrandKitRow = typeof brandKits.$inferSelect;

export type BrandKitFields = Omit<
  typeof brandKits.$inferInsert,
  'id' | 'workspaceId' | 'version' | 'createdAt'
>;

const UNIQUE_VIOLATION = '23505';

/**
 * A brand kit change is a new version, N+1; old versions stay, because compiled prompts and
 * outputs point at them (invariant 8). A clash on the version number is retried.
 */
export async function createBrandKitVersion(
  db: Database,
  workspaceId: string,
  fields: BrandKitFields,
): Promise<BrandKitRow> {
  const d = unwrap(db);
  for (let attempt = 0; ; attempt++) {
    try {
      const [row] = await d
        .insert(brandKits)
        .values({
          ...fields,
          workspaceId,
          version: sql`(SELECT COALESCE(MAX(${brandKits.version}), 0) + 1 FROM ${brandKits} WHERE ${brandKits.workspaceId} = ${workspaceId})`,
        })
        .returning();
      if (!row) throw new Error('Brand kit insert returned no row');
      return row;
    } catch (err) {
      const code =
        (err as { code?: string }).code ?? (err as { cause?: { code?: string } }).cause?.code;
      if (code !== UNIQUE_VIOLATION || attempt >= 3) throw err;
    }
  }
}

/** Newest first. */
export async function listBrandKitVersions(
  db: Database,
  workspaceId: string,
  limit = 20,
): Promise<BrandKitRow[]> {
  return unwrap(db)
    .select()
    .from(brandKits)
    .where(eq(brandKits.workspaceId, workspaceId))
    .orderBy(desc(brandKits.version))
    .limit(limit);
}
