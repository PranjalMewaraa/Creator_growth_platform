import type { PostTargetStatus, TargetPlatform } from '@cgp/contracts';
import type { Database } from '@cgp/db';
import { calendarWeek } from './calendar';
import { listAccounts } from './publishing';
import { syncCentre, type SyncAttempt } from './sync';

/**
 * Home (S-04, week 8): what needs attention in the next seven days. It answers three
 * questions in the order a creator asks them — is anything broken, what is going out, and
 * where are the gaps — and it is assembled from what the Calendar and the Sync centre already
 * know rather than from a fourth source of truth.
 */

/** A token this close to expiry is worth saying out loud before a post fails on it. */
export const EXPIRY_WARNING_DAYS = 14;

export interface HomeDay {
  /** Midnight in the workspace's timezone, as an instant. */
  startsAt: string;
  weekday: string;
  day: string;
  isToday: boolean;
  posts: Array<{
    id: string;
    at: string;
    text: string;
    platforms: TargetPlatform[];
    statuses: PostTargetStatus[];
  }>;
}

export interface HomeAccount {
  platform: TargetPlatform;
  displayName: string | null;
  connected: boolean;
  health: string;
  tokenExpiresAt: string | null;
  /** Days until the token dies, when the platform said. Negative once it has. */
  expiresInDays: number | null;
  needsAttention: boolean;
}

export interface HomeDigest {
  days: HomeDay[];
  /** Targets a person has to deal with: nothing moves these on its own (WP31, WP35). */
  needsAttention: SyncAttempt[];
  accounts: HomeAccount[];
  scheduled: number;
  /** Days in the next seven with nothing on them. The empty slot is the primary action. */
  emptyDays: number;
}

/**
 * Midnight at the start of a day, in a named timezone, as an instant. The workspace's own
 * day, not the server's: a post at 00:30 in Jaipur belongs to that day whatever the machine
 * running this thinks the date is.
 */
export function startOfDayIn(timezone: string, at: Date): Date {
  const ymd = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
  // Local midnight read as if it were UTC, then moved back by however far ahead of UTC that
  // zone was at that moment, which is where daylight saving is accounted for.
  const asIfUtc = new Date(`${ymd}T00:00:00Z`);
  return new Date(asIfUtc.getTime() - offsetOf(timezone, asIfUtc));
}

/** How far ahead of UTC a timezone was at a given instant, in milliseconds. */
function offsetOf(timezone: string, at: Date): number {
  const utc = new Date(at.toLocaleString('sv-SE', { timeZone: 'UTC' }));
  const local = new Date(at.toLocaleString('sv-SE', { timeZone: timezone }));
  return local.getTime() - utc.getTime();
}

export async function homeDigest(
  db: Database,
  workspaceId: string,
  timezone: string,
  { now = new Date() }: { now?: Date } = {},
): Promise<HomeDigest> {
  const from = startOfDayIn(timezone, now);
  const to = new Date(from.getTime() + 7 * 86_400_000);
  const [posts, sync, accounts] = await Promise.all([
    calendarWeek(db, workspaceId, from, to),
    syncCentre(db, workspaceId),
    listAccounts(db, workspaceId),
  ]);

  const weekday = new Intl.DateTimeFormat('en-IN', { weekday: 'short', timeZone: timezone });
  const dayNumber = new Intl.DateTimeFormat('en-IN', { day: 'numeric', timeZone: timezone });
  const dayKey = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  const days: HomeDay[] = Array.from({ length: 7 }, (_, offset) => {
    const startsAt = new Date(from.getTime() + offset * 86_400_000);
    const key = dayKey.format(startsAt);
    return {
      startsAt: startsAt.toISOString(),
      weekday: weekday.format(startsAt),
      day: dayNumber.format(startsAt),
      isToday: offset === 0,
      posts: posts
        .filter((post) => dayKey.format(new Date(post.scheduledAt)) === key)
        .map((post) => ({
          id: post.id,
          at: post.scheduledAt,
          text: post.text,
          platforms: post.targets.map((t) => t.platform),
          statuses: post.targets.map((t) => t.status),
        })),
    };
  });

  return {
    days,
    needsAttention: sync.stuck,
    accounts: accountHealth(accounts, now),
    scheduled: posts.length,
    emptyDays: days.filter((day) => day.posts.length === 0).length,
  };
}

function accountHealth(
  accounts: Awaited<ReturnType<typeof listAccounts>>,
  now: Date,
): HomeAccount[] {
  const platforms: TargetPlatform[] = ['instagram', 'linkedin'];
  return platforms.map((platform) => {
    const account = accounts.find((a) => a.platform === platform);
    const expiresInDays = account?.tokenExpiresAt
      ? Math.round((new Date(account.tokenExpiresAt).getTime() - now.getTime()) / 86_400_000)
      : null;
    return {
      platform,
      displayName: account?.displayName ?? null,
      connected: Boolean(account),
      health: account?.health ?? 'missing',
      tokenExpiresAt: account?.tokenExpiresAt ?? null,
      expiresInDays,
      // Not connected is not "attention": it is a choice until someone tries to post with it.
      needsAttention: Boolean(
        account &&
        (account.health !== 'ok' ||
          (expiresInDays !== null && expiresInDays <= EXPIRY_WARNING_DAYS)),
      ),
    };
  });
}
