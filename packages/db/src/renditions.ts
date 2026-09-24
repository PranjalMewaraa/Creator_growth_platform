import { and, eq } from 'drizzle-orm';
import { unwrap, type Database } from './client';
import { renditions } from './schema';
import type { TargetPlatform } from '@cgp/contracts';

export type RenditionRow = typeof renditions.$inferSelect;

/**
 * A rendition is derived, not authored: one per output per platform, replaced whenever the
 * spec that made it changes. The unique index on (output_id, platform) is what makes this an
 * upsert rather than a pile of near identical pictures.
 */
export async function saveRendition(
  db: Database,
  workspaceId: string,
  fields: { outputId: string; platform: TargetPlatform; spec: unknown; storageKey: string },
): Promise<RenditionRow> {
  const [row] = await unwrap(db)
    .insert(renditions)
    .values({ ...fields, workspaceId })
    .onConflictDoUpdate({
      target: [renditions.outputId, renditions.platform],
      set: { spec: fields.spec, storageKey: fields.storageKey },
    })
    .returning();
  if (!row) throw new Error('Rendition upsert returned no row');
  return row;
}

/** Every rendition of the given outputs, for showing what has already been composited. */
export async function renditionsFor(
  db: Database,
  workspaceId: string,
  outputIds: string[],
): Promise<RenditionRow[]> {
  if (outputIds.length === 0) return [];
  const rows = await unwrap(db)
    .select()
    .from(renditions)
    .where(eq(renditions.workspaceId, workspaceId));
  return rows.filter((row) => outputIds.includes(row.outputId));
}

/** One output's rendition for a platform, or nothing when it has never been composited. */
export async function findRendition(
  db: Database,
  workspaceId: string,
  outputId: string,
  platform: TargetPlatform,
): Promise<RenditionRow | undefined> {
  const [row] = await unwrap(db)
    .select()
    .from(renditions)
    .where(
      and(
        eq(renditions.workspaceId, workspaceId),
        eq(renditions.outputId, outputId),
        eq(renditions.platform, platform),
      ),
    );
  return row;
}
