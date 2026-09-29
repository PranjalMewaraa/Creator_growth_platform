import type { Logger } from '@cgp/config';
import type { PostContent, PostMetrics, Publisher, TargetPlatform } from '@cgp/contracts';
import { recentPostTargets, SEED_POST_PREFIX, type Database } from '@cgp/db';

/**
 * Insights (S-21, week 8): what the platforms say about what went out, ranked against this
 * workspace's own baseline rather than against anybody else's.
 *
 * Fetched when the screen opens rather than polled (plan section 3: "on demand fetch when
 * Insights opens"). A demo workspace has a handful of posts, and a poller is a thing that
 * breaks quietly in the background.
 *
 * Nothing here is estimated. A platform that does not report a number leaves it absent, and
 * the screen says so, because an invented engagement number is the one number in this product
 * that would be worth lying about and therefore the one to be most careful with.
 */

export interface InsightPost {
  targetId: string;
  platform: TargetPlatform;
  account: string;
  text: string;
  publishedAt: string | null;
  permalink: string | null;
  metrics: PostMetrics;
  /** Reactions plus comments plus shares and saves: what is comparable across both platforms. */
  engagement: number | null;
  /** How this post sits against the median of this workspace's own posts on that platform. */
  standing: 'above' | 'typical' | 'below' | null;
}

export interface InsightsView {
  posts: InsightPost[];
  /** The median engagement per platform, and how many posts it was taken from. */
  baselines: Array<{ platform: TargetPlatform; median: number; posts: number }>;
  /** Platforms that reported nothing at all, so the screen can say which and why. */
  silent: TargetPlatform[];
}

/** The engagement a post earned, from whichever numbers the platform gave. Null when none. */
export function engagementOf(metrics: PostMetrics): number | null {
  const parts = [metrics.likes, metrics.comments, metrics.shares, metrics.saves].filter(
    (value): value is number => typeof value === 'number',
  );
  return parts.length > 0 ? parts.reduce((sum, value) => sum + value, 0) : null;
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
    : (sorted[middle] ?? 0);
}

/** A fifth either side of the median is "about usual"; a baseline of one post has no spread. */
function standingOf(engagement: number | null, baseline: number, sample: number) {
  if (engagement === null || sample < 2) return null;
  if (engagement > baseline * 1.2) return 'above' as const;
  if (engagement < baseline * 0.8) return 'below' as const;
  return 'typical' as const;
}

export interface InsightsDeps {
  db: Database;
  publishers: Readonly<Record<TargetPlatform, Publisher>>;
  /** Opens a stored token (D11), the same way the publish handler does. */
  decryptToken: (ciphertext: string) => string;
  log: Logger;
}

export async function insights(
  deps: InsightsDeps,
  workspaceId: string,
  { limit = 25 }: { limit?: number } = {},
): Promise<InsightsView> {
  const recent = await recentPostTargets(deps.db, workspaceId, { limit: 200 });
  const published = recent
    .filter(
      ({ target }) =>
        target.status === 'published' &&
        target.platformPostId &&
        // Seeded calendar history never reached a platform, so no platform can report on it.
        // Listing it with empty metrics would suggest one was asked and said nothing, which
        // is the closest this screen could get to fabricating a number (plan section 15).
        !target.platformPostId.startsWith(SEED_POST_PREFIX),
    )
    .slice(0, limit);

  // In parallel: a handful of posts, and each platform answers on its own schedule.
  const posts = await Promise.all(
    published.map(async ({ target, account, publication }): Promise<InsightPost> => {
      const body = publication.body as Partial<PostContent>;
      let metrics: PostMetrics = { fetchedAt: new Date().toISOString() };
      try {
        metrics = await deps.publishers[account.platform].metrics(
          {
            externalId: account.externalId,
            accessToken: deps.decryptToken(account.tokenCiphertext),
          },
          target.platformPostId ?? '',
        );
      } catch (err) {
        deps.log.warn({ err, targetId: target.id }, 'insights fetch failed for one post');
      }
      return {
        targetId: target.id,
        platform: account.platform,
        account: account.displayName ?? account.externalId,
        text: body.text ?? '',
        publishedAt: target.publishedAt?.toISOString() ?? null,
        permalink: target.permalink,
        metrics,
        engagement: engagementOf(metrics),
        standing: null,
      };
    }),
  );

  const platforms = [...new Set(posts.map((post) => post.platform))];
  const baselines = platforms.map((platform) => {
    const scores = posts
      .filter((post) => post.platform === platform && post.engagement !== null)
      .map((post) => post.engagement as number);
    return { platform, median: median(scores), posts: scores.length };
  });

  for (const post of posts) {
    const baseline = baselines.find((entry) => entry.platform === post.platform);
    post.standing = standingOf(post.engagement, baseline?.median ?? 0, baseline?.posts ?? 0);
  }

  return {
    posts,
    baselines,
    silent: baselines.filter((entry) => entry.posts === 0).map((entry) => entry.platform),
  };
}
