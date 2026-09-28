import { and, eq } from 'drizzle-orm';
import { unwrap, type Database } from './client';
import { renditions } from './schema';
import type { TargetPlatform } from '@cgp/contracts';

export type RenditionRow = typeof renditions.$inferSelect;

/**
 * What was derived. `layer` is the picture with its text composited over it; `post` is the
 * post ready copy, cut to the platform's frames and already checked (WP32).
 */
export type RenditionKind = 'layer' | 'post';

/**
 * A rendition is derived, not authored: one per output per platform per kind, replaced
 * whenever the spec that made it changes. The unique index is what makes this an upsert
 * rather than a pile of near identical pictures.
 */
export async function saveRendition(
  db: Database,
  workspaceId: string,
  fields: {
    outputId: string;
    platform: TargetPlatform;
    spec: unknown;
    storageKey: string;
    kind?: RenditionKind;
  },
): Promise<RenditionRow> {
  const [row] = await unwrap(db)
    .insert(renditions)
    .values({ ...fields, kind: fields.kind ?? 'layer', workspaceId })
    .onConflictDoUpdate({
      target: [renditions.outputId, renditions.platform, renditions.kind],
      set: { spec: fields.spec, storageKey: fields.storageKey },
    })
    .returning();
  if (!row) throw new Error('Rendition upsert returned no row');
  return row;
}

/**
 * Every rendition of the given outputs, for showing what has already been composited. Layers
 * only by default: a post ready copy is a cache, not something the Studio should draw.
 */
export async function renditionsFor(
  db: Database,
  workspaceId: string,
  outputIds: string[],
  kind: RenditionKind = 'layer',
): Promise<RenditionRow[]> {
  if (outputIds.length === 0) return [];
  const rows = await unwrap(db)
    .select()
    .from(renditions)
    .where(and(eq(renditions.workspaceId, workspaceId), eq(renditions.kind, kind)));
  return rows.filter((row) => outputIds.includes(row.outputId));
}

/** One output's rendition for a platform, or nothing when it has never been composited. */
export async function findRendition(
  db: Database,
  workspaceId: string,
  outputId: string,
  platform: TargetPlatform,
  kind: RenditionKind = 'layer',
): Promise<RenditionRow | undefined> {
  const [row] = await unwrap(db)
    .select()
    .from(renditions)
    .where(
      and(
        eq(renditions.workspaceId, workspaceId),
        eq(renditions.outputId, outputId),
        eq(renditions.platform, platform),
        eq(renditions.kind, kind),
      ),
    );
  return row;
}
