import type { TargetPlatform } from '@cgp/contracts';
import { ArrowUpRightIcon, Badge, Card, CardBody, CardHeader, cx } from '@cgp/ui';
import { firstRun, homeDigest, type HomeDay } from '@cgp/core';
import Link from 'next/link';
import { FirstRun } from '@/components/first-run';
import { Screen } from '@/components/screen';
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
          'flex h-full flex-col items-center gap-1 rounded-xl py-3 transition hover:bg-black/40',
          day.isToday ? 'bg-black/80' : 'bg-black/15',
        )}
        title={
          day.posts.length === 0
            ? 'Nothing planned. Write something for this day.'
            : day.posts
                .map((post) => `${clock(post.at)} ${post.text || 'No caption'}`)
                .join(String.fromCharCode(10))
        }
      >
        <span className="text-xs text-white/75">{day.weekday}</span>
        <span className="text-lg font-semibold tabular-nums">{day.day}</span>
        {day.posts.length === 0 ? (
          <span className="mt-1 text-xs text-white/40" aria-label="Nothing planned">
            +
          </span>
        ) : (
          <span className="mt-1 flex gap-0.5" aria-label={`${day.posts.length} scheduled`}>
            {day.posts.slice(0, 3).map((post) => (
              <span key={post.id} className="size-1.5 rounded-full bg-white" />
            ))}
          </span>
        )}
      </Link>
    </li>
  );
}

export default async function HomePage({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  const { workspace } = await requireWorkspace(workspaceId);
  const base = `/w/${workspace.id}`;
  const db = getDb();
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
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
        <Card>
          <CardHeader title="Balance" note="Credits and video seconds are counted separately." />
          <CardBody className="flex flex-col gap-4">
            <p className="text-4xl font-semibold tracking-tight tabular-nums text-ink">
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

        <section className="relative overflow-hidden rounded-2xl bg-hot p-5 text-white">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-medium text-white/85">Next seven days</h2>
              <p className="mt-1 text-3xl font-semibold tracking-tight">
                {digest.scheduled === 0
                  ? 'Nothing scheduled'
                  : `${digest.scheduled} post${digest.scheduled === 1 ? '' : 's'} scheduled`}
              </p>
              <p className="mt-1 max-w-md text-sm text-white/80">
                {digest.emptyDays === 0
                  ? 'Every day this week has something on it.'
                  : `${digest.emptyDays} day${digest.emptyDays === 1 ? ' has' : 's have'} nothing on them. Pick one to fill it.`}
              </p>
            </div>
            <Link
              href={`${base}/calendar`}
              aria-label="Open calendar"
              className="grid size-9 shrink-0 place-items-center rounded-full bg-black/20 hover:bg-black/30"
            >
              <ArrowUpRightIcon />
            </Link>
          </div>
          <ol className="mt-6 grid grid-cols-7 gap-2">
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
              <Link href={`${base}/accounts`} className="text-xs text-muted hover:text-ink">
                Manage
              </Link>
            }
          />
          <CardBody>
            <ul className="flex flex-col gap-2">
              {digest.accounts.map((account) => (
                <li
                  key={account.platform}
                  className="flex items-center justify-between rounded-xl border border-line bg-raised px-4 py-3"
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
      <p className="mt-1 truncate text-lg font-semibold tabular-nums text-ink">{value}</p>
    </div>
  );
}
