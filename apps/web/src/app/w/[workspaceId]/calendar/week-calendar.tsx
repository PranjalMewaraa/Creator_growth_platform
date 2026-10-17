'use client';

import type { CalendarPost } from '@cgp/core';
import type { TargetPlatform } from '@cgp/contracts';
import { Avatar, Badge, cx } from '@cgp/ui';
import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';
import { artStyle } from '@/lib/art';
import { COMING_BACK, IN_FLIGHT, NEEDS_YOU, STATUS_BADGE, STATUS_SHORT } from '@/lib/post-status';

// Calendar week view (S-07, WP34), styled after a scheduling board: channels and settings on
// the left, the week as a time grid on the right, one card per post. The posts are the
// workspace's own, fetched a week at a time, each carrying a chip per target, because status
// lives on the target: one post can reach LinkedIn and fail on Instagram.

interface Account {
  id: string;
  platform: TargetPlatform;
  displayName: string;
}

/** The grid's usual span. It widens when a post falls outside it. */
const START_HOUR = 8;
const END_HOUR = 20;
const HOUR_PX = 92;
const CARD_PX = 220;

const NAMES: Record<TargetPlatform, string> = { instagram: 'Instagram', linkedin: 'LinkedIn' };
const RING: Record<TargetPlatform, string> = {
  instagram: 'bg-gradient-to-tr from-[#f9ce34] via-[#ee2a7b] to-[#6228d7]',
  linkedin: 'bg-[#0a66c2]',
};

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

/** Hours past midnight, in the viewer's own clock, which is the clock the grid is drawn in. */
function hourOf(iso: string) {
  const at = new Date(iso);
  return at.getHours() + at.getMinutes() / 60;
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

/** One chip per target: which platform, and where that platform's copy got to. */
function TargetChips({ post }: { post: CalendarPost }) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      {post.targets.map((target) => (
        <Badge
          key={target.id}
          tone={STATUS_BADGE[target.status]}
          dot={<span className={cx('size-1.5 shrink-0 rounded-full', RING[target.platform])} />}
          className="px-1.5"
        >
          <span title={`${NAMES[target.platform]} · ${target.account}`}>
            {STATUS_SHORT[target.status]}
          </span>
        </Badge>
      ))}
    </div>
  );
}

export function WeekCalendar({
  workspaceId,
  workspaceName,
  timezone,
  accounts,
  art,
}: {
  workspaceId: string;
  workspaceName: string;
  timezone: string;
  accounts: Account[];
  art: string[];
}) {
  const [weekOffset, setWeekOffset] = useState(0);
  // The week a result belongs to is kept with it, so moving to another week shows that week
  // as loading rather than briefly showing the last one's posts under the new dates.
  const [loaded, setLoaded] = useState<{ week: string; posts: CalendarPost[] } | null>(null);
  const [failed, setFailed] = useState(false);

  const now = new Date();
  const monday = mondayOf(now);
  monday.setDate(monday.getDate() + weekOffset * 7);
  const nextMonday = new Date(monday);
  nextMonday.setDate(monday.getDate() + 7);
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return d;
  });
  const today = now.toDateString();
  const month = monday.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });

  const from = monday.toISOString();
  const to = nextMonday.toISOString();

  const posts = loaded?.week === from ? loaded.posts : null;

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = async () => {
      const url = `/api/w/${workspaceId}/calendar?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
      const response = await fetch(url).catch(() => null);
      if (stopped) return;
      if (!response?.ok) {
        setFailed(true);
        return;
      }
      const body = (await response.json()) as { posts: CalendarPost[] };
      if (stopped) return;
      setFailed(false);
      setLoaded({ week: from, posts: body.posts });
      // A post still moving is worth another look; a settled week is not asked about again.
      const moving = body.posts.some((post) =>
        post.targets.some((t) => IN_FLIGHT.has(t.status) || COMING_BACK.has(t.status)),
      );
      if (moving) timer = setTimeout(() => void run(), 20_000);
    };
    void run();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [workspaceId, from, to]);

  // The grid usually runs 08:00 to 20:00, and stretches to reach a post outside that. It
  // stops at the ends of the day: a post at 23:28 widens the grid to midnight, not to 25:00.
  const hoursUsed = (posts ?? []).map((post) => hourOf(post.scheduledAt));
  const startHour = Math.max(0, Math.min(START_HOUR, ...hoursUsed.map(Math.floor)));
  const endHour = Math.min(24, Math.max(END_HOUR, ...hoursUsed.map((h) => Math.ceil(h) + 1)));
  const hours = Array.from({ length: endHour - startHour + 1 }, (_, i) => startHour + i).filter(
    (h) => h <= 23,
  );

  const settled = (posts ?? []).flatMap((p) => p.targets);
  const summary = [
    { label: 'Scheduled', count: settled.filter((t) => IN_FLIGHT.has(t.status)).length },
    { label: 'Published', count: settled.filter((t) => t.status === 'published').length },
    { label: 'Need you', count: settled.filter((t) => NEEDS_YOU.has(t.status)).length },
  ];

  /** Where an empty slot sends you: the composer, with that time already filled in. */
  const slotHref = (day: Date, hour: number) => {
    const at = new Date(day);
    at.setHours(hour, 0, 0, 0);
    return `/w/${workspaceId}/compose?at=${encodeURIComponent(at.toISOString())}`;
  };

  return (
    <div className="grid items-start gap-5 lg:grid-cols-[300px_minmax(0,1fr)]">
      {/* Left: channels and what the week holds. */}
      <aside className="flex flex-col gap-5 rounded-2xl border border-line bg-surface p-5">
        <h1 className="text-display font-display font-semibold text-ink">{workspaceName}</h1>

        <Section
          title="Channels"
          action={
            <Link
              href={`/w/${workspaceId}/accounts`}
              className="tap-target text-xs text-accent hover:underline"
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
                  <Avatar name={account.displayName} ring={RING[account.platform]} size="lg" />
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

        <Section title="This week">
          <div className="grid grid-cols-3 gap-2">
            {summary.map(({ label, count }) => (
              <div
                key={label}
                className="flex flex-col items-center gap-0.5 rounded-xl border border-line bg-raised px-2 py-3"
              >
                <span className="text-xl font-semibold font-mono tabular-nums text-ink">
                  {posts === null ? '·' : count}
                </span>
                <span className="text-center text-[11px] leading-tight text-muted">{label}</span>
              </div>
            ))}
          </div>
          <Link
            href={`/w/${workspaceId}/compose`}
            className="flex h-11 items-center justify-center rounded-xl bg-accent text-sm font-medium text-accent-ink transition hover:opacity-90"
          >
            Write a post
          </Link>
        </Section>

        <Section title="Time zone">
          <div className="flex h-11 items-center justify-between rounded-xl border border-line bg-raised px-4 text-sm text-ink">
            {timezone} · Workspace
          </div>
          <p className="text-xs leading-5 text-muted">
            The grid is drawn in this browser&rsquo;s own clock. A scheduled post goes out within a
            minute of its time.
          </p>
        </Section>
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
              className="grid size-11 place-items-center rounded-lg text-muted hover:bg-surface hover:text-ink"
            >
              ‹
            </button>
            <button
              type="button"
              onClick={() => setWeekOffset(0)}
              className="h-11 rounded-lg px-3 text-sm text-muted hover:bg-surface hover:text-ink"
            >
              Today
            </button>
            <button
              type="button"
              aria-label="Next week"
              onClick={() => setWeekOffset((w) => w + 1)}
              className="grid size-11 place-items-center rounded-lg text-muted hover:bg-surface hover:text-ink"
            >
              ›
            </button>
          </div>
          <span className="ml-auto text-xs text-muted" aria-live="polite">
            {failed
              ? 'Could not load this week'
              : posts === null
                ? 'Loading…'
                : posts.length === 0
                  ? 'Nothing scheduled — pick a slot'
                  : `${posts.length} post${posts.length === 1 ? '' : 's'}`}
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
                        'grid size-10 place-items-center rounded-full text-2xl font-light font-mono tabular-nums',
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
              style={{ height: (endHour - startHour) * HOUR_PX + CARD_PX / 2 }}
            >
              <div className="relative">
                {hours.map((h) => (
                  <span
                    key={h}
                    className="absolute right-3 -translate-y-1/2 text-xs font-mono tabular-nums text-muted"
                    style={{ top: (h - startHour) * HOUR_PX + 12 }}
                  >
                    {hhmm(h)}
                  </span>
                ))}
              </div>
              {days.map((d) => {
                const onThisDay = (posts ?? []).filter(
                  (post) => new Date(post.scheduledAt).toDateString() === d.toDateString(),
                );
                return (
                  <div key={d.toISOString()} className="relative border-l border-line/60">
                    {hours.map((h) => (
                      <span
                        key={h}
                        className="absolute inset-x-0 border-t border-dashed border-line/50"
                        style={{ top: (h - startHour) * HOUR_PX + 12 }}
                      />
                    ))}

                    {/* An empty slot is the primary way to start a post (S-07). Underneath the
                        cards, so a click on a post opens the post. */}
                    {hours.map((h) => {
                      const at = new Date(d);
                      at.setHours(h, 0, 0, 0);
                      return (
                        <Link
                          key={h}
                          href={slotHref(d, h)}
                          aria-label={`Write a post for ${d.toLocaleDateString('en-IN', {
                            weekday: 'long',
                            day: 'numeric',
                            month: 'short',
                          })} at ${hhmm(h)}`}
                          className={cx(
                            'group absolute inset-x-2 grid place-items-center rounded-xl border border-dashed border-transparent transition',
                            at > now
                              ? 'hover:border-accent/50 hover:bg-accent/5'
                              : 'pointer-events-none',
                          )}
                          style={{ top: (h - startHour) * HOUR_PX + 14, height: HOUR_PX - 4 }}
                        >
                          {/* Faint always, bright on hover or focus: a slot nobody can see is
                              not an affordance, it is a secret (WP51). */}
                          <span
                            className={cx(
                              'text-xl transition duration-base ease-standard',
                              at > now
                                ? 'text-faint/40 group-hover:text-accent group-focus-visible:text-accent'
                                : 'text-transparent',
                            )}
                          >
                            +
                          </span>
                        </Link>
                      );
                    })}

                    {onThisDay.map((post, i) => {
                      const hour = hourOf(post.scheduledAt);
                      const account = post.targets[0];
                      return (
                        <article
                          key={post.id}
                          className="group absolute inset-x-2 overflow-hidden rounded-2xl border border-line bg-raised/90 shadow-lg shadow-black/30 transition hover:-translate-y-0.5 hover:border-faint"
                          style={{ top: (hour - startHour) * HOUR_PX + 12, height: CARD_PX }}
                        >
                          <div
                            className="relative m-1.5 h-[120px] overflow-hidden rounded-xl"
                            style={
                              post.mediaUrl
                                ? {
                                    backgroundImage: `url("${post.mediaUrl}")`,
                                    backgroundSize: 'cover',
                                    backgroundPosition: 'center',
                                  }
                                : artStyle(i + weekOffset * 3, art)
                            }
                          >
                            <span className="absolute left-2 top-2 rounded-full bg-black/50 px-2 py-0.5 text-[10px] font-medium text-white backdrop-blur">
                              {hhmm(hour)}
                            </span>
                            {post.render ? (
                              <span
                                className={cx(
                                  'absolute right-2 top-2 rounded-full px-2 py-0.5 text-[10px] font-medium backdrop-blur',
                                  post.render === 'rendering'
                                    ? 'bg-black/60 text-white'
                                    : 'bg-bad/80 text-white',
                                )}
                              >
                                {post.render === 'rendering' ? 'Rendering…' : 'Render failed'}
                              </span>
                            ) : null}
                            {account ? (
                              <div className="absolute inset-x-1.5 bottom-1.5 flex items-center gap-2 rounded-lg bg-black/45 p-1.5 backdrop-blur">
                                <Avatar
                                  name={account.account}
                                  ring={RING[account.platform]}
                                  size="sm"
                                />
                                <span className="min-w-0">
                                  <span className="block truncate text-xs font-medium text-white">
                                    {account.account.replace(/^@/, '')}
                                  </span>
                                  <span className="block truncate text-[10px] text-white/70">
                                    {post.targets.length > 1
                                      ? `${post.targets.length} accounts`
                                      : NAMES[account.platform]}
                                  </span>
                                </span>
                              </div>
                            ) : null}
                          </div>
                          <div className="flex flex-col gap-2 px-3 pb-3 pt-1">
                            <p className="truncate text-[13px] text-ink" title={post.text}>
                              {post.text || 'No caption'}
                            </p>
                            <TargetChips post={post} />
                          </div>
                        </article>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
