import { desc, eq, sql } from 'drizzle-orm';
import { unwrap, type Database } from './client';
import { workspaceProfiles } from './schema';

export type ProfileRow = typeof workspaceProfiles.$inferSelect;

/** Everything a profile says, without the bookkeeping columns. */
export type ProfileFields = Omit<
  typeof workspaceProfiles.$inferInsert,
  'id' | 'workspaceId' | 'version' | 'createdAt'
>;

const UNIQUE_VIOLATION = '23505';

/**
 * Every correction is a new version, N+1; an old version never changes, because compiled
 * prompts point at it (invariant 8). Two saves at once can pick the same number, so the loser
 * of the unique constraint tries again with the next one.
 */
export async function createProfileVersion(
  db: Database,
  workspaceId: string,
  fields: ProfileFields,
): Promise<ProfileRow> {
  const d = unwrap(db);
  for (let attempt = 0; ; attempt++) {
    try {
      const [row] = await d
        .insert(workspaceProfiles)
        .values({
          ...fields,
          workspaceId,
          version: sql`(SELECT COALESCE(MAX(${workspaceProfiles.version}), 0) + 1 FROM ${workspaceProfiles} WHERE ${workspaceProfiles.workspaceId} = ${workspaceId})`,
        })
        .returning();
      if (!row) throw new Error('Profile insert returned no row');
      return row;
    } catch (err) {
      const code =
        (err as { code?: string; cause?: { code?: string } }).code ??
        (err as { cause?: { code?: string } }).cause?.code;
      if (code !== UNIQUE_VIOLATION || attempt >= 3) throw err;
    }
  }
}

/** Newest first. */
export async function listProfileVersions(
  db: Database,
  workspaceId: string,
  limit = 20,
): Promise<ProfileRow[]> {
  return unwrap(db)
    .select()
    .from(workspaceProfiles)
    .where(eq(workspaceProfiles.workspaceId, workspaceId))
    .orderBy(desc(workspaceProfiles.version))
    .limit(limit);
}
