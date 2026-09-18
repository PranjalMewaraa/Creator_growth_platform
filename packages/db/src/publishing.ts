import type { NormalizedError, PostTargetStatus, TargetPlatform } from '@cgp/contracts';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { unwrap, type Database } from './client';
import { jobs, postTargets, publications, socialAccounts } from './schema';

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
}

/** Connects an account, or refreshes its token if it is already connected. */
export async function upsertSocialAccount(
  db: Database,
  account: NewSocialAccount,
): Promise<SocialAccountRow> {
  const [row] = await unwrap(db)
    .insert(socialAccounts)
    .values({ ...account, health: 'ok' })
    .onConflictDoUpdate({
      target: [socialAccounts.workspaceId, socialAccounts.platform, socialAccounts.externalId],
      set: {
        displayName: account.displayName,
        scopes: account.scopes,
        tokenCiphertext: account.tokenCiphertext,
        tokenExpiresAt: account.tokenExpiresAt,
        health: 'ok',
      },
    })
    .returning();
  if (!row) throw new Error('Social account upsert returned no row');
  return row;
}

export interface NewPublication {
  workspaceId: string;
  timezone: string;
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

    const [publication] = await tx
      .insert(publications)
      .values({
        workspaceId: request.workspaceId,
        scheduledAt: new Date(),
        timezone: request.timezone,
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
        inArray(postTargets.status, ['pending', 'retry_scheduled']),
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
