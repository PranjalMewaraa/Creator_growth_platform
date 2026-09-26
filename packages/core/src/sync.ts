import type {
  FailureCategory,
  PostContent,
  PostTargetStatus,
  TargetPlatform,
} from '@cgp/contracts';
import { recentPostTargets, type Database } from '@cgp/db';
import { MAX_PUBLISH_ATTEMPTS } from './retry';

/**
 * The Sync centre (S-20, WP35): what is publishing, what just tried, and what the platform
 * said about it.
 *
 * The platform's words are passed through exactly as they arrived (plan section 15: "show the
 * Sync centre error verbatim"). A rewritten error is a worse error: when a post is refused at
 * eleven at night, the only useful thing on the screen is the sentence the platform actually
 * returned, because that is what a search or a support thread will match.
 */

export interface SyncError {
  code: string;
  /** Exactly as the platform said it. Never rephrased, never shortened. */
  message: string;
  category: FailureCategory;
}

export interface SyncAttempt {
  targetId: string;
  publicationId: string;
  platform: TargetPlatform;
  account: string;
  status: PostTargetStatus;
  /** The post itself, enough to recognise which one this is. */
  text: string;
  scheduledAt: string;
  /** When this target was last written to: the moment the attempt ended. */
  updatedAt: string;
  publishedAt: string | null;
  permalink: string | null;
  error: SyncError | null;
  /** Attempts spent, and how many there are in all, so "3 of 5" can be shown. */
  attempt: number;
  maxAttempts: number;
  /** When the worker will try again on its own. Null when nothing is coming. */
  nextAttemptAt: string | null;
}

/** Coming back on its own, after a failure the worker will retry (WP31). */
const COMING_BACK: ReadonlySet<PostTargetStatus> = new Set(['retry_scheduled', 'quota_wait']);

/** Still moving on its own: the worker has it, or is bringing it back. */
const MOVING: ReadonlySet<PostTargetStatus> = new Set(['pending', 'claimed', ...COMING_BACK]);

/** Waiting for a person. Nothing will move these without someone deciding something. */
const STUCK: ReadonlySet<PostTargetStatus> = new Set([
  'reauth_required',
  'needs_verification',
  'failed',
]);

export interface SyncView {
  /** Needs a person: shown first, because nothing else will move it. */
  stuck: SyncAttempt[];
  /** In flight, or coming back on its own. */
  inFlight: SyncAttempt[];
  /** Everything else, most recent first. */
  recent: SyncAttempt[];
}

export async function syncCentre(
  db: Database,
  workspaceId: string,
  { limit = 50 }: { limit?: number } = {},
): Promise<SyncView> {
  const rows = await recentPostTargets(db, workspaceId, { limit });
  const attempts = rows.map(({ target, account, publication, job }): SyncAttempt => {
    const error = target.lastError as SyncError | null;
    const body = publication.body as Partial<PostContent>;
    return {
      targetId: target.id,
      publicationId: publication.id,
      platform: account.platform,
      account: account.displayName ?? account.externalId,
      status: target.status,
      text: body.text ?? '',
      scheduledAt: publication.scheduledAt.toISOString(),
      updatedAt: target.updatedAt.toISOString(),
      publishedAt: target.publishedAt?.toISOString() ?? null,
      permalink: target.permalink,
      error: error?.message ? error : null,
      // The job's count is how many times it has been sent back, so the attempt happening now
      // (or the one that just ended) is one past it. The target's own count is not the same
      // thing: it only moves when a claim succeeds, and an attempt can fail before that.
      attempt: (job?.attemptCount ?? target.attemptCount) + 1,
      maxAttempts: MAX_PUBLISH_ATTEMPTS,
      // Only promise a retry for a status that actually comes back. A job row can still be
      // queued behind a target that has ended — a target failed by hand, or a job the sweep
      // has yet to settle — and "trying again" on something that has given up is a lie the
      // screen must not tell.
      nextAttemptAt:
        COMING_BACK.has(target.status) &&
        job &&
        job.status === 'QUEUED' &&
        job.runAt.getTime() > Date.now()
          ? job.runAt.toISOString()
          : null,
    };
  });

  return {
    stuck: attempts.filter((a) => STUCK.has(a.status)),
    inFlight: attempts.filter((a) => MOVING.has(a.status)),
    recent: attempts.filter((a) => !STUCK.has(a.status) && !MOVING.has(a.status)),
  };
}
