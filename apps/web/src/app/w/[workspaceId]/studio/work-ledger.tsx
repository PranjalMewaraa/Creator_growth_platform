'use client';

import type { JobStage } from '@cgp/contracts';
import { cx, Progress } from '@cgp/ui';

/**
 * What is happening, while it happens (WP44).
 *
 * A storyboard takes eighty seconds and a reel takes four minutes, and the screen used to say
 * nothing for either. This is not a spinner dressed up: every line is a stage the worker
 * really reports, in the order it really happened, and the frames appear as they are drawn
 * rather than all at the end.
 *
 * The note on a waiting stage is the part that matters most. "Waiting for the picture model,
 * which allows two a minute" turns a stall into a known cost, and it is true — the quota is
 * two a minute and we read it off the provider.
 */
export function WorkLedger({ stages, className }: { stages: JobStage[]; className?: string }) {
  if (stages.length === 0) return null;
  const active = stages.find((stage) => stage.status === 'working' || stage.status === 'waiting');
  const counted = active?.total ? { value: (active.index ?? 1) - 1, max: active.total } : undefined;

  return (
    <section
      aria-label="What is happening"
      className={cx('flex flex-col gap-3 rounded-2xl border border-line bg-surface p-5', className)}
    >
      <header className="flex items-baseline justify-between gap-3">
        <h2 className="text-label font-medium uppercase tracking-wide text-muted">Working</h2>
        {active?.total ? (
          <span className="text-caption font-mono tabular-nums text-faint">
            {active.index} of {active.total}
          </span>
        ) : null}
      </header>

      {/* Determinate only when the parts can be counted, which for frames and scenes they can. */}
      <Progress
        label={active?.label ?? 'Working'}
        {...(counted ? { value: counted.value, max: counted.max } : {})}
      />

      <ol className="flex flex-col gap-2">
        {stages.map((stage) => (
          <li key={stage.key} className="flex items-start gap-3">
            <Mark status={stage.status} />
            <div className="min-w-0 flex-1">
              <p
                className={cx(
                  'text-body',
                  stage.status === 'done' ? 'text-muted' : 'text-ink',
                  stage.status === 'failed' && 'text-bad',
                )}
              >
                {stage.label}
                {stage.total ? (
                  <span className="text-muted">
                    {' '}
                    {stage.index} of {stage.total}
                  </span>
                ) : null}
                {stage.seconds !== undefined && stage.status === 'done' ? (
                  <span className="text-faint"> · {stage.seconds}s</span>
                ) : null}
              </p>
              {stage.note ? <p className="text-caption text-faint">{stage.note}</p> : null}
            </div>
            {/* The thing this stage made, as soon as it exists. Waiting is easier to do while
                looking at what the waiting has already bought. */}
            {stage.url ? (
              // Our own bucket, and next/image would need the host configured for a thumbnail
              // that is deliberately this small.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={stage.url}
                alt=""
                className="h-12 w-9 shrink-0 rounded-lg border border-line object-cover motion-safe:animate-[toast-in_200ms_cubic-bezier(0.2,0,0,1)]"
              />
            ) : null}
          </li>
        ))}
      </ol>
    </section>
  );
}

/** A dot that says where a stage got to. Shape and colour together, never colour alone. */
function Mark({ status }: { status: JobStage['status'] }) {
  if (status === 'done') {
    return (
      <span aria-hidden className="mt-1 text-good">
        ✓
      </span>
    );
  }
  if (status === 'failed') {
    return (
      <span aria-hidden className="mt-1 text-bad">
        ×
      </span>
    );
  }
  return (
    <span
      aria-hidden
      className={cx(
        'mt-2 size-2 shrink-0 rounded-full',
        status === 'waiting' ? 'bg-hot' : 'bg-accent motion-safe:animate-pulse',
      )}
    />
  );
}
