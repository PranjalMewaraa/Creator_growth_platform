import type { TargetPlatform } from '@cgp/contracts';
import { ArrowUpRightIcon, Badge, Card, CardBody, CardHeader, cx } from '@cgp/ui';
import { firstRun, homeDigest, type HomeDay } from '@cgp/core';
import Link from 'next/link';
import { FirstRun } from '@/components/first-run';
import { Screen } from '@/components/screen';
import { artStyle } from '@/lib/art';
import { STUDIO_KINDS } from '@/lib/studio-kinds';
import { listArt } from '@/server/art';
import { getDb } from '@/server/runtime';
import { requireWorkspace } from '@/server/session';

const NAMES: Record<TargetPlatform, string> = { instagram: 'Instagram', linkedin: 'LinkedIn' };

/** A day in the strip: what is on it, or a way to put something on it. */
function Day({ day, base, timezone }: { day: HomeDay; base: string; timezone: string }) {
  const clock = (iso: string) =>
    new Date(iso).toLocaleTimeString('en-IN', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: timezone,
    });
  // An empty day is the primary action on this screen (S-04), so it is a link, not a gap.
  // Today goes without a time: its midnight has gone, and the composer would refuse a slot in
  // the past, so its own default of an hour from now is the useful answer.
  const href =
    day.posts.length > 0
      ? `${base}/calendar`
      : day.isToday
        ? `${base}/compose`
        : `${base}/compose?at=${encodeURIComponent(day.startsAt)}`;
  return (
    <li>
      <Link
        href={href}
        className={cx(
          'flex h-full flex-col items-center gap-1 rounded-xl py-3 ring-1 ring-transparent',
          'transition-colors duration-base ease-standard hover:ring-white/30',
          // Today inverts: white on near-black. The rest are ink on orange, because white on
          // #ff5a1f measures 3.12:1 and the rule is 4.5 (WP49). The hover ring sits outside
          // both backgrounds, so it never touches a pair WP49 already measured.
          day.isToday
            ? 'bg-black/80 text-white hover:bg-black/70'
            : 'bg-black/10 hover:bg-black/20',
        )}
        title={
          day.posts.length === 0
            ? 'Nothing planned. Write something for this day.'
            : day.posts
              .map((post) => `${clock(post.at)} ${post.text || 'No caption'}`)
              .join(String.fromCharCode(10))
        }
      >
        <span className={cx('text-xs', day.isToday ? 'text-white/80' : 'text-black/85')}>
          {day.weekday}
        </span>
        <span className="text-lg font-semibold font-mono tabular-nums">{day.day}</span>
        {day.posts.length === 0 ? (
          <span
            className={cx('mt-1 text-xs', day.isToday ? 'text-white/70' : 'text-black/80')}
            aria-label="Nothing planned"
          >
            +
          </span>
        ) : (
          <span className="mt-1 flex gap-0.5" aria-label={`${day.posts.length} scheduled`}>
            {day.posts.slice(0, 3).map((post) => (
              <span
                key={post.id}
                className={cx('size-1.5 rounded-full', day.isToday ? 'bg-white' : 'bg-black/70')}
              />
            ))}
          </span>
        )}
      </Link>
    </li>
  );
}

export const metadata = { title: 'Home' };

export default async function HomePage({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  const { workspace } = await requireWorkspace(workspaceId);
  const base = `/w/${workspace.id}`;
  const db = getDb();
  const art = listArt();
  const [digest, setup] = await Promise.all([
    homeDigest(db, workspaceId, workspace.timezone),
    firstRun(db, workspaceId),
  ]);

  return (
    <Screen title="Home" description="What needs attention in the next seven days.">
      {/* Four steps rather than one banner (WP48): the profile was the only one Home ever
          mentioned, so a workspace could sit with no channel connected and nothing saying
          that was why nothing published. */}
      <FirstRun state={setup} base={base} workspaceId={workspaceId} />

      {/* What's on your mind today? (WP53) — the six real things the Studio can make, not a
          tool catalogue invented for the occasion: STUDIO_KINDS is the exact list Studio's
          own picker reads, so a card here and the card it opens never disagree. The art is
          the same mechanism Studio's picker already used — whatever the team has dropped
          into public/art (real generated images, never stock), gradient where there is
          none — so Home gained nothing make-believe to get this. */}
      <section aria-labelledby="studio-kinds-heading" className="flex flex-col gap-3">
        <h2 id="studio-kinds-heading" className="text-title font-display font-semibold text-ink">
          What&apos;s on your mind today?
        </h2>
        <ol className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {STUDIO_KINDS.map((k, i) => (
            <li key={k.key}>
              <Link
                href={`${base}/studio?kind=${k.key}`}
                title={k.hint}
                style={artStyle(i, art)}
                className="group relative flex aspect-[3/4] flex-col justify-end overflow-hidden rounded-2xl border border-line/80 p-3 ring-1 ring-transparent transition-colors duration-base ease-standard hover:border-accent/60 hover:ring-accent/30"
              >
                {/* Keeps the label readable on any art, same scrim Studio's own tiles use. */}
                <span
                  aria-hidden
                  className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/25 to-transparent"
                />
                <span className="relative flex items-center gap-1.5 text-body font-medium text-white">
                  <k.Icon width={16} height={16} aria-hidden />
                  {k.label}
                </span>
                <span className="relative text-caption leading-4 text-white/75">{k.hint}</span>
                {/* The arrow the reference uses on hover — colour only, no movement, no
                    scale: both are ruled out for hover states (docs/ui-overhaul.md §8). */}
                <ArrowUpRightIcon
                  aria-hidden
                  className="absolute right-3 top-3 text-white/0 transition-colors duration-base ease-standard group-hover:text-white/80"
                />
              </Link>
            </li>
          ))}
        </ol>
      </section>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
        {/* A touch more presence than a plain Card: the ring sits outside the border, the
            glow outside the box, so neither one touches a background a letter sits on.
            `!shadow-floating` because Card's own `shadow-raised` sets the same property and
            `cx` is a plain joiner with no Tailwind-merge — without `!` the two utilities race
            on generated-CSS order (alphabetical: "raised" sorts after "floating" and wins)
            rather than on the order the classes are written in. */}
        <Card className="!shadow-floating ring-1 ring-accent/10">
          <CardHeader title="Balance" note="Credits and video seconds are counted separately." />
          <CardBody className="flex flex-col gap-4">
            <p className="text-4xl font-semibold tracking-tight font-mono tabular-nums text-ink">
              {workspace.creditBalance.toLocaleString('en-IN')}
              <span className="ml-2 text-base font-normal text-muted">credits</span>
            </p>
            <div className="grid grid-cols-2 gap-3">
              <Tile
                label="Credits"
                value={workspace.creditBalance.toLocaleString('en-IN')}
                accent="bg-accent"
              />
              <Tile
                label="Video seconds"
                value={String(workspace.videoSecondsBalance)}
                accent="bg-hot"
              />
            </div>
          </CardBody>
        </Card>

        {/* Ink on orange, not white: #ff5a1f is bright enough that white body text measures
            2.47:1 against it, and the same ink is what every amber control already uses. The
            glow is an external drop-shadow, so it adds presence without touching the flat
            bg-hot the text sits on — nothing here can move a ratio WP49 already measured. */}
        <section className="relative overflow-hidden rounded-2xl border-2 border-cyan-400 bg-transparent p-5 text-white shadow-[0_0_20px_rgba(34,211,238,0.3),_inset_0_0_15px_rgba(34,211,238,0.15)]">
          {/* Neon Border Glow Effect */}
          <div className="pointer-events-none absolute inset-0 rounded-2xl border border-cyan-400 opacity-50 blur-[2px]" />

          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-medium text-cyan-300/80">Next seven days</h2>
              <p className="mt-1 text-3xl font-semibold tracking-tight text-white drop-shadow-[0_0_8px_rgba(34,211,238,0.5)]">
                {digest.scheduled === 0
                  ? 'Nothing scheduled'
                  : `${digest.scheduled} post${digest.scheduled === 1 ? '' : 's'} scheduled`}
              </p>
              <p className="mt-1 max-w-md text-sm text-cyan-100/70">
                {digest.emptyDays === 0
                  ? 'Every day this week has something on it.'
                  : `${digest.emptyDays} day${digest.emptyDays === 1 ? ' has' : 's have'} nothing on them. Pick one to fill it.`}
              </p>
            </div>
            <Link
              href={`${base}/calendar`}
              aria-label="Open calendar"
              className="grid size-11 shrink-0 place-items-center rounded-full bg-cyan-400/10 border border-cyan-400/30 text-cyan-300 transition duration-base ease-standard hover:bg-cyan-400/30 hover:text-white hover:shadow-[0_0_10px_rgba(34,211,238,0.5)]"
            >
              <ArrowUpRightIcon className="size-5" />
            </Link>
          </div>
          <ol className="mt-6 grid grid-cols-7 gap-1 sm:gap-2">
            {digest.days.map((day) => (
              <Day key={day.startsAt} day={day} base={base} timezone={workspace.timezone} />
            ))}
          </ol>
        </section>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader
            title="Account health"
            action={
              <Link
                href={`${base}/accounts`}
                className="tap-target text-xs text-muted hover:text-ink"
              >
                Manage
              </Link>
            }
          />
          <CardBody>
            <ul className="flex flex-col gap-2">
              {digest.accounts.map((account) => (
                <li
                  key={account.platform}
                  className="flex items-center justify-between rounded-xl border border-line bg-raised px-4 py-3 transition-colors duration-base ease-standard hover:border-faint"
                >
                  <span className="min-w-0">
                    <span className="block text-sm text-ink">{NAMES[account.platform]}</span>
                    <span className="block truncate text-xs text-muted">
                      {account.connected
                        ? account.expiresInDays === null
                          ? account.displayName
                          : account.expiresInDays < 0
                            ? `${account.displayName} · token expired`
                            : `${account.displayName} · ${account.expiresInDays} days left`
                        : 'Connect it before scheduling to it'}
                    </span>
                  </span>
                  {/* A state that needs doing something about is a link to the place it is
                      done; one that does not is a badge and nothing more (WP47). */}
                  {!account.connected || account.needsAttention ? (
                    <Link href={`${base}/accounts`}>
                      <Badge tone={account.connected ? 'bad' : 'neutral'}>
                        {account.connected ? 'Needs attention' : 'Not connected'}
                      </Badge>
                    </Link>
                  ) : (
                    <Badge tone="good">Connected</Badge>
                  )}
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Workspace" />
          <CardBody className="grid grid-cols-2 gap-3">
            <Tile label="Name" value={workspace.name} />
            <Tile label="Timezone" value={workspace.timezone} />
          </CardBody>
        </Card>
      </div>
    </Screen>
  );
}

function Tile({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="rounded-xl border border-line bg-raised px-4 py-3">
      <p className="flex items-center gap-2 text-xs text-faint">
        {accent ? <span className={cx('h-3 w-0.5 rounded-full', accent)} aria-hidden /> : null}
        {label}
      </p>
      <p className="mt-1 truncate text-lg font-semibold font-mono tabular-nums text-ink">{value}</p>
    </div>
  );
}
