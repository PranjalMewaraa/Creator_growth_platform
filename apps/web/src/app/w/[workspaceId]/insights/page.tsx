import type { TargetPlatform } from '@cgp/contracts';
import { insights, type InsightPost } from '@cgp/core';
import { parseEncryptionKey, decryptSecret } from '@cgp/config';
import { Badge, Card, CardHeader, EmptyState, type BadgeTone } from '@cgp/ui';
import { Screen } from '@/components/screen';
import { getDb, getEnv, getLogger } from '@/server/runtime';
import { getProviders } from '@/server/providers';
import { requireWorkspace } from '@/server/session';

const NAMES: Record<TargetPlatform, string> = { instagram: 'Instagram', linkedin: 'LinkedIn' };

/** What each platform will and will not report, so a blank column is explained, not mysterious. */
const REPORTS: Record<TargetPlatform, string> = {
  instagram: 'Instagram reports reach, views, likes, comments, saves and shares.',
  linkedin:
    'LinkedIn reports reactions and comments on your own posts. Impressions need organisation access, so they are not shown.',
};

const STANDING: Record<NonNullable<InsightPost['standing']>, { label: string; tone: BadgeTone }> = {
  above: { label: 'Above your usual', tone: 'good' },
  typical: { label: 'About usual', tone: 'neutral' },
  below: { label: 'Below your usual', tone: 'warn' },
};

function Metric({ label, value }: { label: string; value: number | undefined }) {
  // An absent number is absent, never a zero: the platform did not say, which is not "none".
  return (
    <div className="min-w-16">
      <p className="text-xs text-faint">{label}</p>
      <p className="text-base font-semibold tabular-nums text-ink">
        {typeof value === 'number' ? value.toLocaleString('en-IN') : '—'}
      </p>
    </div>
  );
}

/**
 * S-21, Insights. Thin and real (plan section 3): the numbers are fetched from the platforms
 * when this page opens, and nothing is estimated. A post ranks against this workspace's own
 * median rather than against anyone else's account.
 */
export const metadata = { title: 'Insights' };

export default async function InsightsPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  await requireWorkspace(workspaceId);
  const env = getEnv();
  const providers = getProviders();

  const tokenKey = env.TOKEN_ENCRYPTION_KEY;
  const view = tokenKey
    ? await insights(
        {
          db: getDb(),
          publishers: providers.publishers,
          decryptToken: (ciphertext) => decryptSecret(parseEncryptionKey(tokenKey), ciphertext),
          log: getLogger(),
        },
        workspaceId,
      )
    : { posts: [], baselines: [], silent: [] };

  return (
    <Screen
      title="Insights"
      description="What worked, measured against this workspace's own baseline."
    >
      <Card>
        <CardHeader
          title="Published posts"
          note="Numbers come from the platforms when this page opens. Nothing here is estimated."
        />
        {view.posts.length === 0 ? (
          <EmptyState
            title="Nothing published yet"
            description="Insights stay empty until posts have gone out and the platforms report on them."
          />
        ) : (
          <ul className="flex flex-col gap-3 px-5 py-5">
            {view.posts.map((post) => (
              <li
                key={post.targetId}
                className="flex flex-col gap-3 rounded-xl border border-line bg-raised px-4 py-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-muted">
                      {NAMES[post.platform]} · {post.account}
                      {post.publishedAt
                        ? ` · ${new Date(post.publishedAt).toLocaleDateString('en-IN', {
                            day: 'numeric',
                            month: 'short',
                          })}`
                        : ''}
                    </p>
                    <p className="mt-1 line-clamp-2 text-sm text-ink">
                      {post.text || 'No caption'}
                    </p>
                  </div>
                  {post.standing ? (
                    <Badge tone={STANDING[post.standing].tone}>
                      {STANDING[post.standing].label}
                    </Badge>
                  ) : null}
                </div>
                <div className="flex flex-wrap gap-5">
                  <Metric label="Reach" value={post.metrics.reach} />
                  <Metric label="Views" value={post.metrics.views} />
                  <Metric label="Likes" value={post.metrics.likes} />
                  <Metric label="Comments" value={post.metrics.comments} />
                  <Metric label="Saves" value={post.metrics.saves} />
                  <Metric label="Shares" value={post.metrics.shares} />
                  {post.permalink ? (
                    <a
                      href={post.permalink}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="tap-target ml-auto self-end text-xs text-accent hover:underline"
                    >
                      View post ↗
                    </a>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {view.baselines.length > 0 ? (
        <Card>
          <CardHeader
            title="Your baseline"
            note="The median of this workspace's own posts. A post is judged against these, not against anyone else."
          />
          <div className="flex flex-col gap-2 px-5 py-5">
            {view.baselines.map((baseline) => (
              <p key={baseline.platform} className="text-sm text-muted">
                <span className="text-ink">{NAMES[baseline.platform]}</span>:{' '}
                {baseline.posts === 0
                  ? 'nothing reported yet.'
                  : baseline.posts === 1
                    ? 'one post so far, which is not yet a baseline.'
                    : `${baseline.median.toLocaleString('en-IN')} across ${baseline.posts} posts.`}{' '}
                <span className="text-faint">{REPORTS[baseline.platform]}</span>
              </p>
            ))}
          </div>
        </Card>
      ) : null}
    </Screen>
  );
}
