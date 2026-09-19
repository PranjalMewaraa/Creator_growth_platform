'use client';

import type { TargetPlatform } from '@cgp/contracts';
import { cx } from '@cgp/ui';
import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import { artStyle } from '@/lib/art';

// Calendar week view (S-07), styled after a scheduling board: channels and posting settings on
// the left, the week as a time grid on the right, one card per post. The posts are samples
// until scheduling exists; the channels are the workspace's real connected accounts.

interface Account {
  id: string;
  platform: TargetPlatform;
  displayName: string;
}

interface SamplePost {
  day: number;
  /** Hours from midnight, e.g. 9.5 for 09:30. */
  at: number;
  platform: TargetPlatform;
  caption: string;
  tag: string;
  draft?: boolean;
}

const SAMPLES: SamplePost[] = [
  {
    day: 0,
    at: 9,
    platform: 'instagram',
    caption: 'Meet the new small-batch cold brew',
    tag: '#newdrop',
  },
  {
    day: 0,
    at: 14.5,
    platform: 'linkedin',
    caption: 'Three things 18 hours of steeping taught us',
    tag: '#behindthescenes',
  },
  {
    day: 1,
    at: 10.5,
    platform: 'instagram',
    caption: 'Discover our new 30 day brew pass',
    tag: '#discovery',
  },
  {
    day: 2,
    at: 8.5,
    platform: 'instagram',
    caption: 'We are partnering with a Jaipur roastery',
    tag: '#limited',
  },
  {
    day: 2,
    at: 15,
    platform: 'linkedin',
    caption: 'How a two-person team ships weekly',
    tag: '#howto',
    draft: true,
  },
  {
    day: 3,
    at: 11,
    platform: 'instagram',
    caption: 'Limited bottle, only 200 made',
    tag: '#limited',
  },
  {
    day: 4,
    at: 9.5,
    platform: 'linkedin',
    caption: 'What customers told us in week one',
    tag: '#customerstories',
  },
  {
    day: 4,
    at: 16,
    platform: 'instagram',
    caption: 'Friday pour: cold brew tonic',
    tag: '#recipe',
  },
  {
    day: 5,
    at: 12,
    platform: 'instagram',
    caption: 'Weekend market stall: find us here',
    tag: '#jaipur',
  },
  {
    day: 6,
    at: 10,
    platform: 'linkedin',
    caption: 'A week of numbers, honestly shared',
    tag: '#buildinpublic',
    draft: true,
  },
];

const START_HOUR = 8;
const END_HOUR = 20;
const HOUR_PX = 92;
const CARD_PX = 220;

const NAMES: Record<TargetPlatform, string> = { instagram: 'Instagram', linkedin: 'LinkedIn' };
const RING: Record<TargetPlatform, string> = {
  instagram: 'bg-gradient-to-tr from-[#f9ce34] via-[#ee2a7b] to-[#6228d7]',
  linkedin: 'bg-[#0a66c2]',
};

const CADENCES = ['Daily', '3x/week', 'Custom'] as const;

/** The profile's cadence answer, as the nearest option. */
function cadenceOption(cadence: string | null): (typeof CADENCES)[number] {
  if (!cadence) return '3x/week';
  if (/day|daily/i.test(cadence)) return 'Daily';
  if (/3/.test(cadence)) return '3x/week';
  return 'Custom';
}

function mondayOf(date: Date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}

function hhmm(hours: number) {
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function initial(name: string) {
  return name.replace(/^@/, '').trim().charAt(0).toUpperCase() || '?';
}

function Avatar({
  platform,
  name,
  size = 'md',
}: {
  platform: TargetPlatform;
  name: string;
  size?: 'md' | 'sm';
}) {
  return (
    <span
      className={cx('rounded-full p-[2px]', RING[platform], size === 'md' ? 'size-12' : 'size-8')}
    >
      <span
        className={cx(
          'flex h-full w-full items-center justify-center rounded-full bg-raised font-semibold text-ink',
          size === 'md' ? 'text-base' : 'text-xs',
        )}
      >
        {initial(name)}
      </span>
    </span>
  );
}

function Toggle({
  on,
  onChange,
  label,
}: {
  on: boolean;
  onChange: (on: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={cx(
        'relative h-7 w-12 shrink-0 rounded-full border transition',
        on ? 'border-accent bg-accent' : 'border-line bg-raised',
      )}
    >
      <span
        className={cx(
          'absolute top-1/2 size-5 -translate-y-1/2 rounded-full transition-all',
          on ? 'left-6 bg-accent-ink' : 'left-1 bg-faint',
        )}
      />
    </button>
  );
}

function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 border-t border-line pt-5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wide text-muted">{title}</span>
        {action}
      </div>
      {children}
    </div>
  );
}

export function WeekCalendar({
  workspaceId,
  workspaceName,
  timezone,
  cadence,
  accounts,
  art,
}: {
  workspaceId: string;
  workspaceName: string;
  timezone: string;
  cadence: string | null;
  accounts: Account[];
  art: string[];
}) {
  const [weekOffset, setWeekOffset] = useState(0);
  const [plan, setPlan] = useState(cadenceOption(cadence));
  const [bestTime, setBestTime] = useState(true);
  const [recycle, setRecycle] = useState(false);

  const now = new Date();
  const monday = mondayOf(now);
  monday.setDate(monday.getDate() + weekOffset * 7);
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return d;
  });
  const today = now.toDateString();
  const month = monday.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
  const hours = Array.from({ length: END_HOUR - START_HOUR + 1 }, (_, i) => START_HOUR + i);

  const accountFor = (platform: TargetPlatform) =>
    accounts.find((a) => a.platform === platform) ?? {
      id: platform,
      platform,
      displayName: platform === 'instagram' ? '@yourbrand' : 'Your Name',
    };

  return (
    <div className="grid items-start gap-5 lg:grid-cols-[300px_minmax(0,1fr)]">
      {/* Left: channels and schedule settings. */}
      <aside className="flex flex-col gap-5 rounded-2xl border border-line bg-surface p-5">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{workspaceName}</h1>

        <Section
          title="Channels"
          action={
            <Link
              href={`/w/${workspaceId}/accounts`}
              className="text-xs text-accent hover:underline"
            >
              Manage
            </Link>
          }
        >
          {accounts.length > 0 ? (
            <div className="flex flex-wrap gap-4">
              {accounts.map((account) => (
                <div
                  key={account.id}
                  className="flex w-20 flex-col items-center gap-1.5 text-center"
                >
                  <Avatar platform={account.platform} name={account.displayName} />
                  <span className="w-full truncate text-xs text-muted" title={account.displayName}>
                    {account.displayName}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted">No channels connected yet.</p>
          )}
          <Link
            href={`/w/${workspaceId}/accounts`}
            className="flex h-11 items-center justify-center gap-2 rounded-xl border border-dashed border-line text-sm text-ink transition hover:border-faint hover:bg-raised"
          >
            Add new channel <span aria-hidden>+</span>
          </Link>
        </Section>

        <Section title="Post schedule">
          <span className="text-sm text-ink">Posting cadence</span>
          <div className="grid grid-cols-3 rounded-xl border border-line bg-raised p-1">
            {CADENCES.map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={plan === option}
                onClick={() => setPlan(option)}
                className={cx(
                  'rounded-lg py-2 text-sm transition',
                  plan === option
                    ? 'bg-surface font-medium text-ink shadow'
                    : 'text-muted hover:text-ink',
                )}
              >
                {option}
              </button>
            ))}
          </div>

          <span className="mt-1 text-sm text-ink">Time zone</span>
          <div className="flex h-11 items-center justify-between rounded-xl border border-line bg-raised px-4 text-sm text-ink">
            {timezone} · Workspace
          </div>

          <div className="mt-1 flex items-center justify-between gap-3">
            <span className="text-sm text-ink">Auto-suggest best time</span>
            <Toggle on={bestTime} onChange={setBestTime} label="Auto-suggest best time" />
          </div>
          <div className="flex items-center justify-between gap-3">
            <span>
              <span className="block text-sm text-ink">Auto-recycle evergreen</span>
              <span className="block text-xs text-muted">Showcases top posts in rotation</span>
            </span>
            <Toggle on={recycle} onChange={setRecycle} label="Auto-recycle evergreen" />
          </div>
        </Section>

        {/* The agent, in the AI accent. */}
        <div className="ai-surface ai-glow flex flex-col gap-3 rounded-2xl p-4">
          <span className="ai-text text-xs font-semibold uppercase tracking-wide">✳ AI Agent</span>
          <p className="ml-auto max-w-[85%] rounded-xl rounded-br-sm bg-white/10 px-3 py-2 text-xs leading-5 text-ink">
            Plan next week across all my channels
          </p>
          <p className="max-w-[90%] rounded-xl rounded-bl-sm bg-black/30 px-3 py-2 text-xs leading-5 text-muted">
            Drafted 7 posts across {Math.max(accounts.length, 2)} channels for next week, around
            your pillars and your best times.
          </p>
          <span className="text-[11px] text-muted">
            A preview: the agent arrives with scheduling.
          </span>
        </div>
      </aside>

      {/* Right: the week. */}
      <section className="flex min-w-0 flex-col rounded-2xl border border-line bg-surface">
        <header className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-4">
          <span className="flex h-10 items-center rounded-xl border border-line bg-raised px-4 text-sm font-medium text-ink">
            {month}
          </span>
          <div className="flex rounded-xl border border-line bg-raised p-0.5">
            <button
              type="button"
              aria-label="Previous week"
              onClick={() => setWeekOffset((w) => w - 1)}
              className="grid size-9 place-items-center rounded-lg text-muted hover:bg-surface hover:text-ink"
            >
              ‹
            </button>
            <button
              type="button"
              onClick={() => setWeekOffset(0)}
              className="rounded-lg px-3 text-sm text-muted hover:bg-surface hover:text-ink"
            >
              Today
            </button>
            <button
              type="button"
              aria-label="Next week"
              onClick={() => setWeekOffset((w) => w + 1)}
              className="grid size-9 place-items-center rounded-lg text-muted hover:bg-surface hover:text-ink"
            >
              ›
            </button>
          </div>
          <span className="ml-auto rounded-full border border-line px-3 py-1 text-xs text-muted">
            Sample posts · real ones appear once scheduling lands
          </span>
        </header>

        <div className="overflow-x-auto">
          <div className="min-w-[1180px]">
            {/* Day headings. */}
            <div className="grid grid-cols-[64px_repeat(7,minmax(0,1fr))] border-b border-line">
              <span />
              {days.map((d) => {
                const isToday = d.toDateString() === today;
                return (
                  <div key={d.toISOString()} className="flex flex-col items-center py-3">
                    <span
                      className={cx(
                        'grid size-10 place-items-center rounded-full text-2xl font-light tabular-nums',
                        isToday ? 'bg-accent font-medium text-accent-ink' : 'text-ink',
                      )}
                    >
                      {d.getDate()}
                    </span>
                    <span className={cx('text-xs', isToday ? 'text-accent' : 'text-muted')}>
                      {d.toLocaleDateString('en-IN', { weekday: 'short' })}
                    </span>
                  </div>
                );
              })}
            </div>

            {/* The time grid, with posts placed at their time. */}
            <div
              className="relative grid grid-cols-[64px_repeat(7,minmax(0,1fr))]"
              style={{ height: (END_HOUR - START_HOUR) * HOUR_PX + CARD_PX / 2 }}
            >
              <div className="relative">
                {hours.map((h) => (
                  <span
                    key={h}
                    className="absolute right-3 -translate-y-1/2 text-xs tabular-nums text-muted"
                    style={{ top: (h - START_HOUR) * HOUR_PX + 12 }}
                  >
                    {hhmm(h)}
                  </span>
                ))}
              </div>
              {days.map((d, dayIndex) => (
                <div key={d.toISOString()} className="relative border-l border-line/60">
                  {hours.map((h) => (
                    <span
                      key={h}
                      className="absolute inset-x-0 border-t border-dashed border-line/50"
                      style={{ top: (h - START_HOUR) * HOUR_PX + 12 }}
                    />
                  ))}
                  {SAMPLES.filter((p) => p.day === dayIndex).map((post, i) => {
                    const account = accountFor(post.platform);
                    const when = new Date(d);
                    when.setHours(Math.floor(post.at), Math.round((post.at % 1) * 60));
                    const status = post.draft ? 'Draft' : when < now ? 'Published' : 'Scheduled';
                    const index = SAMPLES.indexOf(post) + weekOffset * 3;
                    return (
                      <article
                        key={i}
                        className="group absolute inset-x-2 overflow-hidden rounded-2xl border border-line bg-raised/90 shadow-lg shadow-black/30 transition hover:-translate-y-0.5 hover:border-faint"
                        style={{ top: (post.at - START_HOUR) * HOUR_PX + 12, height: CARD_PX }}
                      >
                        <div
                          className="relative h-[120px] m-1.5 overflow-hidden rounded-xl"
                          style={artStyle(index, art)}
                        >
                          <span className="absolute left-2 top-2 rounded-full bg-black/50 px-2 py-0.5 text-[10px] font-medium text-white backdrop-blur">
                            {hhmm(post.at)}
                          </span>
                          <span className="absolute right-2 top-2 grid size-7 place-items-center rounded-lg bg-black/50 text-white backdrop-blur">
                            ⋮
                          </span>
                          <div className="absolute inset-x-1.5 bottom-1.5 flex items-center gap-2 rounded-lg bg-black/45 p-1.5 backdrop-blur">
                            <Avatar platform={post.platform} name={account.displayName} size="sm" />
                            <span className="min-w-0">
                              <span className="block truncate text-xs font-medium text-white">
                                {account.displayName.replace(/^@/, '')}
                              </span>
                              <span className="block truncate text-[10px] text-white/70">
                                {NAMES[post.platform]}
                              </span>
                            </span>
                          </div>
                        </div>
                        <div className="flex flex-col gap-2 px-3 pb-3 pt-1">
                          <p className="truncate text-[13px] text-ink">{post.caption}</p>
                          <div className="flex items-center justify-between gap-2">
                            <span className="truncate rounded-md bg-surface px-2 py-0.5 text-[11px] text-muted">
                              {post.tag}
                            </span>
                            <span
                              className={cx(
                                'shrink-0 rounded-full border px-2 py-0.5 text-[10px]',
                                status === 'Published' && 'border-good/50 text-good',
                                status === 'Scheduled' && 'border-accent/50 text-accent',
                                status === 'Draft' && 'border-line text-muted',
                              )}
                            >
                              {status}
                            </span>
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
