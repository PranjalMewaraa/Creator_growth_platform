'use client';

import type { FirstRunKey, FirstRunState } from '@cgp/core';
import { Badge, cx, Progress } from '@cgp/ui';
import Link from 'next/link';
import { useCallback, useMemo, useSyncExternalStore } from 'react';

/**
 * The thread through first run (WP48).
 *
 * One card, four steps, and at any moment exactly one of them is offered. The step that is
 * offered carries the sentence saying what is lost by leaving it, because a skip nobody can
 * price is not a choice — "nothing will publish, and the sync centre stays empty" is the
 * whole reason to connect an account, and it was written nowhere before this.
 *
 * Done comes from the server, read from what has really been saved. Not now does not: it is a
 * preference of this browser, kept out of the database on purpose, because a person putting a
 * step off this afternoon is not a fact about the workspace. Storage can be unavailable, in
 * which case the step simply stays offered.
 */

const KEY = (workspaceId: string) => `cgp:first-run:not-now:${workspaceId}`;

/** Nothing has been put off until this browser says otherwise, which is what the server sees. */
const NONE = '[]';

// Storage is an external system, so it is subscribed to rather than copied into state in an
// effect: the server renders NONE, and React re-reads on the client once it has hydrated.
const listeners = new Set<() => void>();

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  window.addEventListener('storage', onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener('storage', onChange);
  };
}

function write(workspaceId: string, next: FirstRunKey[]) {
  try {
    window.localStorage.setItem(KEY(workspaceId), JSON.stringify(next));
  } catch {
    // A browser that refuses storage keeps offering the step, which is the safe way to fail.
  }
  for (const listener of listeners) listener();
}

export function FirstRun({
  state,
  base,
  workspaceId,
}: {
  state: FirstRunState;
  base: string;
  workspaceId: string;
}) {
  const raw = useSyncExternalStore(
    subscribe,
    useCallback(() => {
      try {
        return window.localStorage.getItem(KEY(workspaceId)) ?? NONE;
      } catch {
        return NONE;
      }
    }, [workspaceId]),
    () => NONE,
  );

  const later = useMemo<FirstRunKey[]>(() => {
    try {
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as FirstRunKey[]) : [];
    } catch {
      return [];
    }
  }, [raw]);

  if (state.complete) return null;

  const notNow = (key: FirstRunKey) => write(workspaceId, [...later, key]);
  const undo = (key: FirstRunKey) =>
    write(
      workspaceId,
      later.filter((k) => k !== key),
    );

  // The one step being asked for: the first that is neither done nor put off.
  const offered = state.steps.find((step) => !step.done && !later.includes(step.key));

  return (
    <section
      aria-labelledby="first-run-heading"
      className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-5 shadow-raised"
    >
      <header className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 id="first-run-heading" className="text-subtitle font-semibold text-ink">
          Getting started
        </h2>
        <span className="text-caption tabular-nums text-muted">
          {state.done} of {state.total} done
        </span>
      </header>

      <Progress label="Setup progress" value={state.done} max={state.total} />

      <ol className="flex flex-col">
        {state.steps.map((step, i) => {
          const putOff = !step.done && later.includes(step.key);
          const isOffered = offered?.key === step.key;
          return (
            <li
              key={step.key}
              className={cx(
                'flex items-start gap-3 border-t border-line py-4 first:border-t-0 first:pt-0',
                putOff && 'opacity-60',
              )}
            >
              <Mark done={step.done} index={i + 1} current={isOffered} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <h3
                    className={cx(
                      'text-body font-medium',
                      step.done ? 'text-muted line-through decoration-line' : 'text-ink',
                    )}
                  >
                    {step.title}
                  </h3>
                  {step.required && !step.done ? <Badge tone="warn">Required</Badge> : null}
                  {putOff ? <Badge tone="neutral">Not now</Badge> : null}
                </div>

                {step.done ? null : <p className="mt-1 text-caption text-muted">{step.what}</p>}

                {isOffered ? (
                  <>
                    {/* The price of leaving it, next to the button that leaves it. */}
                    <p className="mt-3 rounded-lg border border-accent/30 bg-accent/5 px-3 py-2 text-caption text-ink">
                      {step.breaks}
                    </p>
                    <div className="mt-3 flex flex-wrap items-center gap-3">
                      <Link
                        href={`${base}${step.path}`}
                        className="inline-flex h-11 items-center rounded-xl bg-accent px-5 text-body font-medium text-accent-ink transition duration-base ease-standard hover:opacity-90"
                      >
                        {step.cta}
                      </Link>
                      {step.required ? null : (
                        <button
                          type="button"
                          onClick={() => notNow(step.key)}
                          className="cursor-pointer rounded-lg px-2 py-1 text-body text-muted transition duration-base ease-standard hover:text-ink"
                        >
                          Not now
                        </button>
                      )}
                    </div>
                  </>
                ) : null}

                {putOff ? (
                  <button
                    type="button"
                    onClick={() => undo(step.key)}
                    className="mt-2 cursor-pointer rounded-lg text-caption text-accent hover:underline"
                  >
                    Do it now
                  </button>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/** Where a step got to. A number while it is ahead of you, a tick once it is behind. */
function Mark({ done, index, current }: { done: boolean; index: number; current: boolean }) {
  return (
    <span
      aria-hidden
      className={cx(
        'mt-0.5 grid size-6 shrink-0 place-items-center rounded-full border text-caption font-medium',
        done
          ? 'border-good bg-good/15 text-good'
          : current
            ? 'border-accent bg-accent text-accent-ink'
            : 'border-line text-faint',
      )}
    >
      {done ? '✓' : index}
    </span>
  );
}
