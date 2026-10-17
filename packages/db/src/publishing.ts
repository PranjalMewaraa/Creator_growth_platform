import type { JobStatus, NormalizedError, PostTargetStatus, TargetPlatform } from '@cgp/contracts';
import { and, asc, desc, eq, gte, inArray, isNull, lt, sql } from 'drizzle-orm';
import { unwrap, type Database } from './client';
import { jobs, outputs, postTargets, publications, socialAccounts } from './schema';

export type SocialAccountRow = typeof socialAccounts.$inferSelect;
export type PostTargetRow = typeof postTargets.$inferSelect;
export type PublicationRow = typeof publications.$inferSelect;

export interface NewSocialAccount {
  workspaceId: string;
  platform: TargetPlatform;
  externalId: string;
  displayName: string | null;
  scopes: string[];
  /** Already envelope encrypted (D11); this package never sees a token in the clear. */
  tokenCiphertext: string;
  tokenExpiresAt: Date | null;
  /** This row is the team's own account, borrowable by other workspaces (WP52). */
  sharedDemo?: boolean;
}

/** Connects an account, or refreshes its token if it is already connected. */
export async function upsertSocialAccount(
  db: Database,
  account: NewSocialAccount,
): Promise<SocialAccountRow> {
  const sharedDemo = account.sharedDemo ?? false;
  const [row] = await unwrap(db)
    .insert(socialAccounts)
    .values({ ...account, sharedDemo, health: 'ok' })
    .onConflictDoUpdate({
      target: [socialAccounts.workspaceId, socialAccounts.platform, socialAccounts.externalId],
      set: {
        displayName: account.displayName,
        scopes: account.scopes,
        tokenCiphertext: account.tokenCiphertext,
        tokenExpiresAt: account.tokenExpiresAt,
        sharedDemo,
        health: 'ok',
      },
    })
    .returning();
  if (!row) throw new Error('Social account upsert returned no row');
  return row;
}

/**
 * The team's own account for a platform, if one has been marked borrowable (WP52).
 *
 * This is a deliberate, narrow exception to invariant 1: it reads across workspaces, which
 * `scoped()` exists specifically to prevent. It is safe because the only thing it can ever
 * return is a row the team itself flagged `shared_demo = true` — there is no path from a
 * caller's input to this query, so it cannot be used to read anyone else's account.
 */
export async function findSharedDemoAccount(
  db: Database,
  platform: TargetPlatform,
): Promise<SocialAccountRow | undefined> {
  const [row] = await unwrap(db)
    .select()
    .from(socialAccounts)
    .where(and(eq(socialAccounts.platform, platform), eq(socialAccounts.sharedDemo, true)))
    .orderBy(desc(socialAccounts.createdAt))
    .limit(1);
  return row;
}

export interface NewPublication {
  workspaceId: string;
  timezone: string;
  /** When it should go out. Now, for a post now (WP31). */
  scheduledAt?: Date;
  /** The output it was made from, when it came from the Studio (WP33). */
  sourceOutputId?: string;
  /** The shared source, as the user wrote it. */
  body: Record<string, unknown>;
  /** One per account, each with its own body: the per platform variant (A7). */
  targets: Array<{ socialAccountId: string; body: Record<string, unknown> }>;
  correlationId?: string;
}

export type CreatePublicationResult =
  | {
      ok: true;
      publication: PublicationRow;
      targets: PostTargetRow[];
      jobs: Array<typeof jobs.$inferSelect>;
    }
  | { ok: false; reason: 'account_not_found' };

/**
 * A publication, one target per account and one publish job per target, in one transaction,
 * so no target can exist without the job that will publish it (invariant 2: the sweep finds
 * the job). Publishing holds no credit, so the jobs carry no ledger entries. The caller
 * enqueues the jobs after this returns.
 */
export async function createPublication(
  db: Database,
  request: NewPublication,
): Promise<CreatePublicationResult> {
  const ids = [...new Set(request.targets.map((t) => t.socialAccountId))];
  return unwrap(db).transaction(async (tx): Promise<CreatePublicationResult> => {
    const accounts = await tx
      .select({ id: socialAccounts.id })
      .from(socialAccounts)
      .where(
        and(eq(socialAccounts.workspaceId, request.workspaceId), inArray(socialAccounts.id, ids)),
      );
    if (
      ids.length === 0 ||
      ids.length !== request.targets.length ||
      accounts.length !== ids.length
    ) {
      return { ok: false, reason: 'account_not_found' };
    }

    const scheduledAt = request.scheduledAt ?? new Date();
    const [publication] = await tx
      .insert(publications)
      .values({
        workspaceId: request.workspaceId,
        scheduledAt,
        timezone: request.timezone,
        sourceOutputId: request.sourceOutputId,
        body: request.body,
      })
      .returning();
    if (!publication) throw new Error('Publication insert returned no row');

    const targets = await tx
      .insert(postTargets)
      .values(
        request.targets.map((target) => ({
          workspaceId: request.workspaceId,
          publicationId: publication.id,
          socialAccountId: target.socialAccountId,
          body: target.body,
        })),
      )
      .returning();
    const created = await tx
      .insert(jobs)
      .values(
        targets.map((target) => ({
          workspaceId: request.workspaceId,
          jobClass: 'publish' as const,
          generatorKey: PUBLISH_TARGET,
          input: { postTargetId: target.id },
          correlationId: request.correlationId,
          // The schedule is the job's, not only the publication's: the dispatcher reads it
          // here, and a worker that boots into a pending schedule leaves it alone.
          runAt: scheduledAt,
        })),
      )
      .returning();
    return { ok: true, publication, targets, jobs: created };
  });
}

/** The job generator key that publishes one post target. */
export const PUBLISH_TARGET = 'publish_target';

export async function findPostTarget(
  db: Database,
  workspaceId: string,
  targetId: string,
): Promise<{ target: PostTargetRow; account: SocialAccountRow } | undefined> {
  const [row] = await unwrap(db)
    .select({ target: postTargets, account: socialAccounts })
    .from(postTargets)
    .innerJoin(socialAccounts, eq(socialAccounts.id, postTargets.socialAccountId))
    .where(and(eq(postTargets.id, targetId), eq(postTargets.workspaceId, workspaceId)));
  return row;
}

export async function findPublication(
  db: Database,
  workspaceId: string,
  publicationId: string,
): Promise<
  | {
      publication: PublicationRow;
      targets: Array<{ target: PostTargetRow; account: SocialAccountRow }>;
    }
  | undefined
> {
  const d = unwrap(db);
  const [publication] = await d
    .select()
    .from(publications)
    .where(and(eq(publications.id, publicationId), eq(publications.workspaceId, workspaceId)));
  if (!publication) return undefined;
  const targets = await d
    .select({ target: postTargets, account: socialAccounts })
    .from(postTargets)
    .innerJoin(socialAccounts, eq(socialAccounts.id, postTargets.socialAccountId))
    .where(eq(postTargets.publicationId, publication.id))
    .orderBy(asc(socialAccounts.platform));
  return { publication, targets };
}

export interface PublicationWithTargets {
  publication: PublicationRow;
  targets: Array<{ target: PostTargetRow; account: SocialAccountRow }>;
  /** The job behind the post's media, when it came from the Studio rather than an upload. */
  renderStatus: JobStatus | null;
}

/**
 * Everything due in a stretch of time, for the calendar (WP34). One query for the
 * publications and one for their targets, rather than one per publication: a week is a
 * handful of posts, but a month view later would be a hundred.
 */
export async function publicationsBetween(
  db: Database,
  workspaceId: string,
  from: Date,
  to: Date,
): Promise<PublicationWithTargets[]> {
  const d = unwrap(db);
  const rows = await d
    .select({ publication: publications, renderStatus: jobs.status })
    .from(publications)
    // Outer joins: a post written in the composer has no source output, and that is the
    // ordinary case rather than the exception.
    .leftJoin(outputs, eq(outputs.id, publications.sourceOutputId))
    .leftJoin(jobs, eq(jobs.id, outputs.jobId))
    .where(
      and(
        eq(publications.workspaceId, workspaceId),
        gte(publications.scheduledAt, from),
        lt(publications.scheduledAt, to),
      ),
    )
    .orderBy(asc(publications.scheduledAt));
  if (rows.length === 0) return [];

  const targets = await d
    .select({ target: postTargets, account: socialAccounts })
    .from(postTargets)
    .innerJoin(socialAccounts, eq(socialAccounts.id, postTargets.socialAccountId))
    .where(
      and(
        eq(postTargets.workspaceId, workspaceId),
        inArray(
          postTargets.publicationId,
          rows.map((row) => row.publication.id),
        ),
      ),
    )
    .orderBy(asc(socialAccounts.platform));

  return rows.map(({ publication, renderStatus }) => ({
    publication,
    targets: targets.filter((t) => t.target.publicationId === publication.id),
    renderStatus,
  }));
}

export interface RecentPostTarget {
  target: PostTargetRow;
  account: SocialAccountRow;
  publication: PublicationRow;
  /** The publish job behind it: when it is next due, and how many attempts it has spent. */
  job: { status: JobStatus; runAt: Date; attemptCount: number } | null;
}

/**
 * The most recently touched post targets, for the Sync centre (WP35). Ordered by when each
 * was last written to rather than when it was created, so a target that just failed its
 * fourth attempt is at the top where someone can see it.
 */
export async function recentPostTargets(
  db: Database,
  workspaceId: string,
  { limit = 50 }: { limit?: number } = {},
): Promise<RecentPostTarget[]> {
  const rows = await unwrap(db)
    .select({
      target: postTargets,
      account: socialAccounts,
      publication: publications,
      jobStatus: jobs.status,
      runAt: jobs.runAt,
      attemptCount: jobs.attemptCount,
    })
    .from(postTargets)
    .innerJoin(socialAccounts, eq(socialAccounts.id, postTargets.socialAccountId))
    .innerJoin(publications, eq(publications.id, postTargets.publicationId))
    // The job that publishes this target names it in its input. A left join because a target
    // whose job was swept away still belongs in the list, saying so.
    .leftJoin(
      jobs,
      and(
        eq(jobs.jobClass, 'publish'),
        sql`${jobs.input}->>'postTargetId' = ${postTargets.id}::text`,
      ),
    )
    .where(eq(postTargets.workspaceId, workspaceId))
    .orderBy(desc(postTargets.updatedAt))
    .limit(limit);

  return rows.map(({ target, account, publication, jobStatus, runAt, attemptCount }) => ({
    target,
    account,
    publication,
    job:
      jobStatus && runAt !== null && attemptCount !== null
        ? { status: jobStatus, runAt, attemptCount }
        : null,
  }));
}

/** The platform draft id, kept so a restarted job polls the same draft instead of a new one. */
export async function setPreparedRef(db: Database, targetId: string, ref: string): Promise<void> {
  await unwrap(db)
    .update(postTargets)
    .set({ preparedRef: ref })
    .where(eq(postTargets.id, targetId));
}

/**
 * Invariant 9, the claim from implementation plan 4.7: only a target that is waiting and holds
 * no post id can be claimed. Returns undefined when someone else has it, or it is done.
 */
export async function claimPostTarget(
  db: Database,
  targetId: string,
): Promise<PostTargetRow | undefined> {
  const [row] = await unwrap(db)
    .update(postTargets)
    .set({
      status: 'claimed',
      claimedAt: new Date(),
      attemptCount: sqlIncrement(),
      publishStartedAt: null,
    })
    .where(
      and(
        eq(postTargets.id, targetId),
        // Every status that is still waiting its turn: never one that has ended, and never
        // one a person has to deal with first (reauth_required, needs_verification).
        inArray(postTargets.status, ['pending', 'retry_scheduled', 'quota_wait']),
        isNull(postTargets.platformPostId),
      ),
    )
    .returning();
  return row;
}

/** Written immediately before the irreversible call (A8). */
export async function markPublishStarted(db: Database, targetId: string): Promise<void> {
  await unwrap(db)
    .update(postTargets)
    .set({ publishStartedAt: new Date() })
    .where(and(eq(postTargets.id, targetId), eq(postTargets.status, 'claimed')));
}

/** Written first thing after the platform answers, before anything else can fail. */
export async function markPublished(
  db: Database,
  targetId: string,
  platformPostId: string,
  permalink: string | undefined,
): Promise<void> {
  await unwrap(db)
    .update(postTargets)
    .set({
      status: 'published',
      platformPostId,
      permalink: permalink ?? null,
      publishedAt: new Date(),
      lastError: null,
    })
    .where(eq(postTargets.id, targetId));
}

/** Any other outcome. `published` is not allowed here: only markPublished records a post. */
export async function markPostTarget(
  db: Database,
  targetId: string,
  status: Exclude<PostTargetStatus, 'published' | 'claimed'>,
  error: NormalizedError | null,
  { clearPublishStarted = false }: { clearPublishStarted?: boolean } = {},
): Promise<void> {
  await unwrap(db)
    .update(postTargets)
    .set({
      status,
      lastError: error,
      ...(clearPublishStarted ? { publishStartedAt: null } : {}),
    })
    .where(and(eq(postTargets.id, targetId), isNull(postTargets.platformPostId)));
}

function sqlIncrement() {
  return sql`${postTargets.attemptCount} + 1`;
}
