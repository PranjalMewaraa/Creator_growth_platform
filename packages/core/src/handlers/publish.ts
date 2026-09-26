import type {
  FailureCategory,
  NormalizedError,
  PostContent,
  PostTargetStatus,
  Publisher,
  PublishAccount,
  TargetPlatform,
} from '@cgp/contracts';
import { isAdapterError } from '@cgp/contracts';
import {
  claimPostTarget,
  findPostTarget,
  markPostTarget,
  markPublished,
  markPublishStarted,
  setPreparedRef,
  type Database,
} from '@cgp/db';
import { JobRetry, type JobHandler, type JobOutcome } from '../process';
import { nextAttemptAt } from '../retry';

export interface PublishHandlerDeps {
  db: Database;
  publishers: Readonly<Record<TargetPlatform, Publisher>>;
  /** Opens a stored token (D11). Only the worker holds the key. */
  decryptToken: (ciphertext: string) => string;
  /** How long to wait for the platform to finish processing media. */
  maxProcessingMs?: number;
  pollMs?: number;
  /** Injected in tests, so a backoff is a fact rather than a coin toss. */
  now?: () => Date;
  random?: () => number;
}

/** A target that ended somewhere other than published. The job fails; the target says why. */
export class PublishNotCompleted extends Error {
  override readonly name = 'PublishNotCompleted';
  constructor(readonly status: PostTargetStatus) {
    super(`Post target ended ${status}`);
  }
}

/** The four failure categories onto post target statuses (plan section 14). */
const STATUS_FOR: Record<FailureCategory, Exclude<PostTargetStatus, 'published' | 'claimed'>> = {
  retriable: 'retry_scheduled',
  quota: 'quota_wait',
  reauth: 'reauth_required',
  terminal: 'failed',
};

/** The two that come back on their own. The other two wait for a person (WP31). */
const RETRIES: ReadonlySet<PostTargetStatus> = new Set(['retry_scheduled', 'quota_wait']);

const DONE: ReadonlySet<PostTargetStatus> = new Set([
  'published',
  'needs_verification',
  'failed',
  'reauth_required',
]);

function normalized(err: unknown): NormalizedError {
  if (isAdapterError(err)) {
    return { code: err.code, message: err.message, category: err.category };
  }
  return {
    code: 'UNEXPECTED',
    message: err instanceof Error ? err.message : String(err),
    category: 'retriable',
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Publishes one post target. Everything before the platform's irreversible call is safe to
 * repeat; the call itself happens only after a successful claim (invariant 9), and the post id
 * is written the moment it comes back. A job that finds its target claimed with the publish
 * already started cannot know whether the post went out, so the target goes to
 * needs_verification and is never retried automatically.
 */
export function createPublishHandler(deps: PublishHandlerDeps): JobHandler {
  const pollMs = deps.pollMs ?? 2000;
  const maxProcessingMs = deps.maxProcessingMs ?? 120_000;
  const now = deps.now ?? (() => new Date());
  const random = deps.random ?? Math.random;

  return async (job, log) => {
    const outcome = (platform: string): JobOutcome => ({
      actual: { credits: 0, videoSeconds: 0 },
      telemetry: { actionClass: 'publish', provider: platform, realisedCostInr: 0 },
    });
    const { postTargetId } = job.input as { postTargetId?: unknown };
    if (typeof postTargetId !== 'string') throw new Error('Publish job has no post target');
    const found = await findPostTarget(deps.db, job.workspaceId, postTargetId);
    if (!found) throw new Error('Post target not found');
    const { account } = found;
    let { target } = found;

    const end = async (
      status: Exclude<PostTargetStatus, 'published' | 'claimed'>,
      error: NormalizedError | null,
      options?: { clearPublishStarted?: boolean },
    ): Promise<never> => {
      // A category that comes back on its own gets another attempt, if any are left. The
      // target keeps the waiting status so the Sync centre can say it is coming back; the job
      // carries the time. When the attempts run out the target fails with the platform's own
      // last error, category and all, so it stays visible that this was a retriable failure
      // we stopped retrying rather than a refusal.
      if (RETRIES.has(status)) {
        const category = status === 'quota_wait' ? 'quota' : 'retriable';
        const runAt = nextAttemptAt(job.attemptCount, category, { now: now(), random });
        if (runAt) {
          await markPostTarget(deps.db, target.id, status, error, options);
          log.warn(
            { postTargetId: target.id, status, error, runAt, attempt: job.attemptCount + 1 },
            'post target not published, trying again later',
          );
          throw new JobRetry(runAt);
        }
        await markPostTarget(deps.db, target.id, 'failed', error, options);
        log.error(
          { postTargetId: target.id, error, attempts: job.attemptCount + 1 },
          'post target failed: attempts exhausted',
        );
        throw new PublishNotCompleted('failed');
      }
      await markPostTarget(deps.db, target.id, status, error, options);
      log.warn({ postTargetId: target.id, status, error }, 'post target not published');
      throw new PublishNotCompleted(status);
    };

    // Already settled one way or another: a redelivered job changes nothing.
    if (target.platformPostId || DONE.has(target.status)) {
      log.info({ postTargetId: target.id, status: target.status }, 'post target already settled');
      return outcome(account.platform);
    }
    // A previous run claimed it. If it got as far as the publish call, nobody knows whether
    // the post went out: never guess, never retry.
    if (target.status === 'claimed') {
      if (target.publishStartedAt) {
        return end('needs_verification', {
          code: 'INTERRUPTED_DURING_PUBLISH',
          message: 'The worker stopped during the publish call. Check the account before retrying.',
          category: 'terminal',
        });
      }
      await markPostTarget(deps.db, target.id, 'retry_scheduled', null);
    }

    const publisher = deps.publishers[account.platform];
    const token: PublishAccount = {
      externalId: account.externalId,
      accessToken: deps.decryptToken(account.tokenCiphertext),
    };
    const content = target.body as PostContent;

    // Phase 1, safe to repeat: a platform draft stays private until published.
    let prepared;
    try {
      prepared = target.preparedRef
        ? { platform: account.platform, ref: target.preparedRef }
        : await publisher.prepare(token, content);
      if (!target.preparedRef) await setPreparedRef(deps.db, target.id, prepared.ref);
      const started = Date.now();
      for (;;) {
        const state = await publisher.check(token, prepared);
        if (state.state === 'ready') break;
        if (state.state === 'failed')
          return await end(STATUS_FOR[state.error.category], state.error);
        if (Date.now() - started > maxProcessingMs) {
          return await end('retry_scheduled', {
            code: 'PROCESSING_TIMEOUT',
            message: 'The platform was still processing the media',
            category: 'retriable',
          });
        }
        await sleep(pollMs);
      }
    } catch (err) {
      // `end` throws to leave, and both of its exits pass through here: neither is a new
      // failure to be classified again.
      if (err instanceof PublishNotCompleted || err instanceof JobRetry) throw err;
      const error = normalized(err);
      return end(STATUS_FOR[error.category], error);
    }

    // Phase 2, the claim. From here on nothing may mark the target retryable unless the
    // platform definitely refused: a failure to record the result leaves the target claimed
    // with the publish started, which the next run turns into needs_verification.
    const claimed = await claimPostTarget(deps.db, target.id);
    if (!claimed) {
      log.info({ postTargetId: target.id }, 'post target claimed elsewhere; stopping');
      return outcome(account.platform);
    }
    target = claimed;
    await markPublishStarted(deps.db, target.id);

    let published;
    try {
      published = await publisher.publish(token, prepared, content);
    } catch (err) {
      const error = normalized(err);
      // An HTTP answer is a definite refusal: nothing was posted, so the usual rules apply.
      // No answer at all (network, timeout) might mean it went out: verify, never retry.
      const definite = isAdapterError(err) && err.code.startsWith('HTTP_');
      if (definite) return end(STATUS_FOR[error.category], error, { clearPublishStarted: true });
      return end('needs_verification', error);
    }
    await markPublished(deps.db, target.id, published.platformPostId, published.permalink);
    log.info(
      { postTargetId: target.id, platform: account.platform, postId: published.platformPostId },
      'published',
    );
    return outcome(account.platform);
  };
}
