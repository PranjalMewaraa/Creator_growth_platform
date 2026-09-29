import { and, desc, eq, like } from 'drizzle-orm';
import { unwrap, type Database } from './client';
import { postTargets, publications, socialAccounts, workspaceProfiles } from './schema';

/**
 * Calendar history for a demo workspace (plan section 15: "4 to 6 weeks of calendar history").
 * Posts that were never sent anywhere, written straight into the tables so the Calendar has a
 * past to scroll back through.
 *
 * Two rules keep this honest, and both matter more than they look.
 *
 * It writes no jobs. `createPublication` makes a publish job per target, and a job dated last
 * Tuesday is a job the dispatcher considers overdue: seeding six weeks of history through the
 * normal path would hand the worker two dozen posts to publish immediately, for real if
 * PUBLISHING were real. So the rows go in directly, already finished.
 *
 * Every seeded target carries a platform post id beginning `seed-`, and nothing else in the
 * product ever writes one. That prefix is what lets Insights leave them alone: a post that
 * never reached a platform has nothing to report, and listing it with empty metrics would
 * imply the platform was asked and stayed silent (plan section 15: never fabricate a number).
 */

export const SEED_POST_PREFIX = 'seed-';

/** Times a creator actually posts, in the workspace's own clock. */
const HOURS = [9, 14.5, 18];

export interface SeedHistoryOptions {
  weeks?: number;
  perWeek?: number;
  /** The workspace's timezone, so a seeded post lands at a plausible local hour. */
  timezone?: string;
  now?: Date;
}

export interface SeededHistory {
  publications: number;
  targets: number;
  from: Date;
  to: Date;
}

/** Captions built from the workspace's own pillars, so the calendar reads like its content. */
function captions(pillars: string[]): string[] {
  const fallback = ['Behind the scenes', 'How to', 'Customer stories'];
  const themes = pillars.length > 0 ? pillars : fallback;
  const shapes = [
    (theme: string) => `${theme}: the part nobody sees`,
    (theme: string) => `What ${theme.toLowerCase()} taught us this month`,
    (theme: string) => `${theme}, in three minutes`,
    (theme: string) => `A small thing about ${theme.toLowerCase()}`,
    (theme: string) => `${theme} — one batch at a time`,
  ];
  return themes.flatMap((theme) => shapes.map((shape) => shape(theme)));
}

/** Local hour of a day, as an instant, given how far ahead of UTC the zone is. */
function at(day: Date, hour: number, offsetMs: number): Date {
  const midnightUtc = new Date(
    Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 0, 0, 0),
  );
  return new Date(midnightUtc.getTime() + hour * 3_600_000 - offsetMs);
}

function offsetOf(timezone: string, when: Date): number {
  const utc = new Date(when.toLocaleString('sv-SE', { timeZone: 'UTC' }));
  const local = new Date(when.toLocaleString('sv-SE', { timeZone: timezone }));
  return local.getTime() - utc.getTime();
}

/**
 * Writes the history. Existing seeded rows are replaced rather than added to, so running it
 * twice leaves one history rather than two overlapping ones.
 */
export async function seedHistory(
  db: Database,
  workspaceId: string,
  { weeks = 6, perWeek = 4, timezone = 'Asia/Kolkata', now = new Date() }: SeedHistoryOptions = {},
): Promise<SeededHistory> {
  const d = unwrap(db);
  const accounts = await d
    .select()
    .from(socialAccounts)
    .where(eq(socialAccounts.workspaceId, workspaceId));
  if (accounts.length === 0) {
    throw new Error('That workspace has no connected accounts, so it can have no history');
  }

  await clearHistory(db, workspaceId);

  // The workspace's own pillars, so its history reads like its content rather than like a
  // fixture. A workspace without a profile falls back to something generic.
  const [profile] = await d
    .select({ pillars: workspaceProfiles.pillars })
    .from(workspaceProfiles)
    .where(eq(workspaceProfiles.workspaceId, workspaceId))
    .orderBy(desc(workspaceProfiles.version))
    .limit(1);
  const lines = captions(profile?.pillars ?? []);
  const offset = offsetOf(timezone, now);
  let made = 0;
  let targetCount = 0;
  const from = new Date(now.getTime() - weeks * 7 * 86_400_000);

  return d.transaction(async (tx) => {
    for (let week = weeks; week >= 1; week--) {
      for (let n = 0; n < perWeek; n++) {
        // Spread through the week rather than clumped: a calendar with four posts on one day
        // and nothing else does not look like anybody's month.
        const dayOffset = Math.floor((n * 7) / perWeek) + (week % 2);
        const day = new Date(now.getTime() - week * 7 * 86_400_000 + dayOffset * 86_400_000);
        const scheduledAt = at(day, HOURS[(week + n) % HOURS.length] ?? 9, offset);
        if (scheduledAt >= now) continue;

        const text = lines[(week * perWeek + n) % lines.length] ?? 'A post';
        const [publication] = await tx
          .insert(publications)
          .values({ workspaceId, scheduledAt, timezone, body: { text } })
          .returning();
        if (!publication) throw new Error('Publication insert returned no row');
        made += 1;

        // One account per post, alternating, so the calendar shows both platforms without
        // every post going to both.
        const account = accounts[(week + n) % accounts.length];
        if (!account) continue;
        await tx.insert(postTargets).values({
          workspaceId,
          publicationId: publication.id,
          socialAccountId: account.id,
          status: 'published',
          body: { text },
          platformPostId: `${SEED_POST_PREFIX}${publication.id}`,
          publishedAt: scheduledAt,
          attemptCount: 1,
        });
        targetCount += 1;
      }
    }
    return { publications: made, targets: targetCount, from, to: now };
  });
}

/** Removes only what this script wrote. Real posts are never touched. */
export async function clearHistory(db: Database, workspaceId: string): Promise<number> {
  const d = unwrap(db);
  const seeded = await d
    .select({ id: postTargets.id, publicationId: postTargets.publicationId })
    .from(postTargets)
    .where(
      and(
        eq(postTargets.workspaceId, workspaceId),
        like(postTargets.platformPostId, `${SEED_POST_PREFIX}%`),
      ),
    );
  if (seeded.length === 0) return 0;
  return d.transaction(async (tx) => {
    for (const row of seeded) {
      await tx.delete(postTargets).where(eq(postTargets.id, row.id));
      await tx.delete(publications).where(eq(publications.id, row.publicationId));
    }
    return seeded.length;
  });
}
