import { ArrowUpRightIcon, Card, CardBody, CardHeader, cx } from '@cgp/ui';
import Link from 'next/link';
import { Screen } from '@/components/screen';
import { requireWorkspace } from '@/server/session';

/** The next seven days as the workspace sees them, starting today in its own timezone. */
function nextSevenDays(timezone: string) {
  const weekday = new Intl.DateTimeFormat('en-IN', { weekday: 'short', timeZone: timezone });
  const day = new Intl.DateTimeFormat('en-IN', { day: 'numeric', timeZone: timezone });
  const now = Date.now();
  return Array.from({ length: 7 }, (_, offset) => {
    const date = new Date(now + offset * 24 * 60 * 60 * 1000);
    return { key: offset, weekday: weekday.format(date), day: day.format(date) };
  });
}

const PLATFORMS = ['Instagram', 'LinkedIn'];

export default async function HomePage({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  const { workspace } = await requireWorkspace(workspaceId);
  const base = `/w/${workspace.id}`;

  return (
    <Screen title="Home" description="What needs attention in the next seven days.">
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
              <p className="mt-1 text-3xl font-semibold tracking-tight">Nothing scheduled</p>
              <p className="mt-1 max-w-md text-sm text-white/80">
                Planned posts and empty slots appear here once the calendar is in use.
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
            {nextSevenDays(workspace.timezone).map(({ key, weekday, day }) => (
              <li
                key={key}
                className={cx(
                  'flex flex-col items-center gap-1 rounded-xl py-3',
                  key === 0 ? 'bg-black/80' : 'bg-black/15',
                )}
              >
                <span className="text-xs text-white/75">{weekday}</span>
                <span className="text-lg font-semibold tabular-nums">{day}</span>
                <span className="mt-1 h-1 w-6 rounded-full bg-white/25" aria-hidden />
              </li>
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
              {PLATFORMS.map((platform) => (
                <li
                  key={platform}
                  className="flex items-center justify-between rounded-xl border border-line bg-raised px-4 py-3"
                >
                  <span className="text-sm text-ink">{platform}</span>
                  <span className="rounded-full border border-line px-2.5 py-0.5 text-xs text-faint">
                    Not connected
                  </span>
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
