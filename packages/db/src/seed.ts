import type { MeteringRates } from '@cgp/contracts';
import { eq } from 'drizzle-orm';
import { unwrap, type Database } from './client';
import { grantIn } from './ledger';
import { seedCatalogIn } from './seed-catalog';
import { scopedOn } from './scoped';
import { brandKits, meteringRates, users, workspaceProfiles, workspaces } from './schema';
import { createWorkspaceIn } from './workspaces';

/** Plan section 7. Prompt compile is absorbed (0 credits, FR-PO-14), so it has no entry. */
export const METERING_RATES_V1: MeteringRates = {
  version: 1,
  credits: { caption_set: 1, hook_title_set: 1, script: 6, image_standard: 15, thumbnail_set: 36 },
};

// Plan levels are unconfirmed (open item 17.6). Placeholder grants until pricing is settled.
const DEMO_GRANT = { credits: 2000, videoSeconds: 120 };

export interface SeedResult {
  skipped: boolean;
  workspaceIds: string[];
}

/**
 * Seed skeleton: metering rates, an owner, one populated workspace and one deliberately near
 * empty (plan section 15), with credits granted through the ledger. Runs in one transaction,
 * and skips the demo data if the owner already exists. The catalog (compiler profiles, default
 * templates) is seeded every time, so new versions reach an existing database.
 */
export async function seedDemo(
  db: Database,
  { ownerEmail }: { ownerEmail: string },
): Promise<SeedResult> {
  const d = unwrap(db);
  return d.transaction(async (tx) => {
    await seedCatalogIn(tx);
    const existing = await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, ownerEmail));
    if (existing.length > 0) return { skipped: true, workspaceIds: [] };

    await tx
      .insert(meteringRates)
      .values({ version: METERING_RATES_V1.version, credits: METERING_RATES_V1.credits })
      .onConflictDoNothing();
    const [owner] = await tx
      .insert(users)
      .values({ email: ownerEmail, name: 'Demo owner' })
      .returning();
    if (!owner) throw new Error('User insert returned no row');

    const populated = await createWorkspaceIn(tx, {
      name: 'Demo Studio',
      ownerUserId: owner.id,
    });
    const ws = scopedOn(tx, populated.id);
    await ws.insert(workspaceProfiles, {
      version: 1,
      contentTypes: ['short video', 'carousel'],
      platforms: ['instagram', 'linkedin'],
      teamShape: 'solo creator',
      goal90d: 'Reach 10k followers',
      cadence: '4 posts a week',
      pillars: ['Behind the scenes', 'How to', 'Customer stories'],
      tone: 'Warm, direct, practical',
    });
    await ws.insert(brandKits, {
      version: 1,
      colors: ['#1F2937', '#F59E0B', '#F9FAFB'],
      typography: 'Inter',
      tagline: 'Made in small batches',
    });

    // No profile or brand kit, so onboarding can be shown without resetting anything.
    const nearEmpty = await createWorkspaceIn(tx, { name: 'New Creator', ownerUserId: owner.id });

    for (const workspace of [populated, nearEmpty]) {
      await tx
        .update(workspaces)
        .set({ videoSecondsCap: DEMO_GRANT.videoSeconds })
        .where(eq(workspaces.id, workspace.id));
      await grantIn(tx, workspace.id, 'credits', DEMO_GRANT.credits);
      await grantIn(tx, workspace.id, 'video_seconds', DEMO_GRANT.videoSeconds);
    }

    return { skipped: false, workspaceIds: [populated.id, nearEmpty.id] };
  });
}
