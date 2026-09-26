'use client';

import type { SyncAttempt, SyncView } from '@cgp/core';
import type { TargetPlatform } from '@cgp/contracts';
import { cx } from '@cgp/ui';
import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';
import { STATUS_TEXT, STATUS_TONE } from '@/lib/post-status';

// Sync centre (S-20, WP35): what is publishing, what just tried, and what the platform said
// about it in its own words.

const NAMES: Record<TargetPlatform, string> = { instagram: 'Instagram', linkedin: 'LinkedIn' };
const RING: Record<TargetPlatform, string> = {
  instagram: 'bg-gradient-to-tr from-[#f9ce34] via-[#ee2a7b] to-[#6228d7]',
  linkedin: 'bg-[#0a66c2]',
};

/** What a person should do about each status that is waiting on one. */
const WHAT_TO_DO: Partial<Record<SyncAttempt['status'], string>> = {
  reauth_required:
    'The account needs reconnecting before this can go out. Nothing is retried until it is.',
  needs_verification:
    'The worker stopped during the publish call, so nobody knows whether the post went out. Check the account. It is never retried on its own, because posting twice is worse than posting late.',
  failed: 'Not sent, and not coming back on its own.',
};

function when(iso: string) {
  const at = new Date(iso);
  return at.toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    // Only when it is not this year: without it, a time twelve months away reads as today.
    ...(at.getFullYear() === new Date().getFullYear() ? {} : { year: 'numeric' }),
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** "in 4 minutes" for something close, a clock time for anything further out. */
function untilText(iso: string) {
  const seconds = Math.round((new Date(iso).getTime() - Date.now()) / 1000);
  if (seconds <= 0) return 'any moment';
  if (seconds < 90) return `in ${seconds}s`;
  if (seconds < 3600) return `in ${Math.round(seconds / 60)} min`;
  return `at ${when(iso)}`;
}

function Avatar({ platform, name }: { platform: TargetPlatform; name: string }) {
  return (
    <span className={cx('size-9 shrink-0 rounded-full p-[2px]', RING[platform])}>
      <span className="flex h-full w-full items-center justify-center rounded-full bg-raised text-xs font-semibold text-ink">
        {name.replace(/^@/, '').trim().charAt(0).toUpperCase() || '?'}
      </span>
    </span>
  );
}

function Attempt({ attempt }: { attempt: SyncAttempt }) {
  const advice = WHAT_TO_DO[attempt.status];
  return (
    <article className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4">
      <div className="flex items-start gap-3">
        <Avatar platform={attempt.platform} name={attempt.account} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-sm font-medium text-ink">{attempt.account}</span>
            <span className="text-xs text-muted">{NAMES[attempt.platform]}</span>
            <span
              className={cx(
                'ml-auto shrink-0 rounded-full border px-2 py-0.5 text-[11px]',
                STATUS_TONE[attempt.status],
              )}
            >
              {STATUS_TEXT[attempt.status]}
            </span>
          </div>
          <p className="mt-1 line-clamp-2 text-sm text-muted" title={attempt.text}>
            {attempt.text || 'No caption'}
          </p>
        </div>
      </div>

      {attempt.error ? (
        <div className="rounded-xl border border-bad/30 bg-bad/5 p-3">
          <div className="flex items-center gap-2">
            <code className="rounded bg-raised px-1.5 py-0.5 text-[11px] text-ink">
              {attempt.error.code}
            </code>
            <span className="text-[11px] uppercase tracking-wide text-muted">
              {attempt.error.category}
            </span>
          </div>
          {/* Verbatim (plan section 15). Whatever the platform said, however it said it. */}
          <p className="mt-2 whitespace-pre-wrap break-words font-mono text-xs leading-5 text-ink">
            {attempt.error.message}
          </p>
        </div>
      ) : null}

      {advice ? <p className="text-xs leading-5 text-muted">{advice}</p> : null}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted">
        {/* Only worth saying once something has been retried: "attempt 1 of 5" on a post that
            went out first time is noise. */}
        {attempt.attempt > 1 ? (
          <span>
            Attempt {Math.min(attempt.attempt, attempt.maxAttempts)} of {attempt.maxAttempts}
          </span>
        ) : null}
        <span title={new Date(attempt.updatedAt).toISOString()}>
          Last tried {when(attempt.updatedAt)}
        </span>
        {attempt.nextAttemptAt ? (
          <span className="text-hot">Trying again {untilText(attempt.nextAttemptAt)}</span>
        ) : null}
        {attempt.permalink ? (
          <a
            href={attempt.permalink}
            target="_blank"
            rel="noreferrer noopener"
            className="ml-auto text-accent hover:underline"
          >
            View post ↗
          </a>
        ) : null}
      </div>
    </article>
  );
}

function Group({
  title,
  hint,
  attempts,
}: {
  title: string;
  hint: string;
  attempts: SyncAttempt[];
}): ReactNode {
  if (attempts.length === 0) return null;
  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="text-sm font-medium uppercase tracking-wide text-muted">
          {title} · {attempts.length}
        </h2>
        <p className="mt-0.5 text-xs text-muted">{hint}</p>
      </div>
      {attempts.map((attempt) => (
        <Attempt key={attempt.targetId} attempt={attempt} />
      ))}
    </section>
  );
}

export function SyncCentre({ workspaceId }: { workspaceId: string }) {
  const [sync, setSync] = useState<SyncView | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = async () => {
      const response = await fetch(`/api/w/${workspaceId}/sync`).catch(() => null);
      if (stopped) return;
      if (!response?.ok) {
        setFailed(true);
        return;
      }
      const body = (await response.json()) as { sync: SyncView };
      if (stopped) return;
      setFailed(false);
      setSync(body.sync);
      // Something in flight is worth watching closely; a quiet workspace is not.
      timer = setTimeout(() => void run(), body.sync.inFlight.length > 0 ? 5_000 : 30_000);
    };
    void run();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [workspaceId]);

  const nothing =
    sync !== null &&
    sync.stuck.length === 0 &&
    sync.inFlight.length === 0 &&
    sync.recent.length === 0;

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-ink">Sync centre</h1>
          <p className="mt-1 text-sm text-muted">
            Every attempt to put a post on a platform, and what the platform said back.
          </p>
        </div>
        <span className="text-xs text-muted" aria-live="polite">
          {failed ? 'Could not load' : sync === null ? 'Loading…' : 'Live'}
        </span>
      </header>

      {sync === null ? (
        <div className="h-40 animate-pulse rounded-2xl border border-line bg-surface" />
      ) : nothing ? (
        <div className="rounded-2xl border border-line bg-surface px-6 py-10 text-center">
          <p className="text-sm text-ink">Nothing has been published from this workspace yet.</p>
          <Link
            href={`/w/${workspaceId}/compose`}
            className="mt-4 inline-flex h-11 items-center rounded-xl bg-accent px-5 text-sm font-medium text-accent-ink transition hover:opacity-90"
          >
            Write a post
          </Link>
        </div>
      ) : (
        <>
          <Group
            title="Needs you"
            hint="Nothing moves these without a decision."
            attempts={sync.stuck}
          />
          <Group
            title="In flight"
            hint="With the worker now, or coming back on its own."
            attempts={sync.inFlight}
          />
          <Group title="Recent" hint="Where the last attempts ended." attempts={sync.recent} />
        </>
      )}
    </div>
  );
}
