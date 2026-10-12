import type { TargetPlatform } from '@cgp/contracts';
import { listAccounts } from '@cgp/core';
import { Badge, Card, CardHeader } from '@cgp/ui';
import { Screen } from '@/components/screen';
import { getDb, getEnv } from '@/server/runtime';
import { oauthApp } from '@/server/oauth';
import { requireWorkspace } from '@/server/session';

const NAMES: Record<TargetPlatform, string> = { instagram: 'Instagram', linkedin: 'LinkedIn' };

/**
 * What each connection can and cannot do, said plainly (S-03, S-19: "capability limits stated
 * honestly"). A creator finding out at publish time that their reel cannot go out is a worse
 * experience than reading it here.
 */
const LIMITS: Record<TargetPlatform, { can: string; cannot: string; needs: string }> = {
  instagram: {
    can: 'Post a single JPEG image with a caption.',
    cannot: 'Publish reels or carousels from here yet.',
    needs: 'A Business or Creator account linked to a Facebook Page.',
  },
  linkedin: {
    can: 'Post text, with or without one image.',
    cannot: 'Publish video from here yet, or post as a company page.',
    needs: 'A personal LinkedIn account; it posts as you.',
  },
};

/** What the round trip left in the address bar, in words. */
const OUTCOMES: Record<string, { tone: 'good' | 'bad'; message: string }> = {
  connected: { tone: 'good', message: 'Connected. The token is stored encrypted.' },
  refused: { tone: 'bad', message: 'The permission screen was cancelled, so nothing changed.' },
  bad_state: {
    tone: 'bad',
    message: 'That connect link had expired or did not start here. Try again from this screen.',
  },
  not_configured: {
    tone: 'bad',
    message: 'This server has no app credentials for that platform yet.',
  },
  exchange_failed: {
    tone: 'bad',
    message: 'The platform refused to swap the code for a token. Its reason is in the server log.',
  },
};

function expiry(iso: string | null): string {
  if (!iso) return 'The platform did not say when this expires.';
  const at = new Date(iso);
  const days = Math.round((at.getTime() - Date.now()) / 86_400_000);
  const when = at.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  return days < 0
    ? `Expired on ${when}. Reconnect before publishing.`
    : `Expires ${when}, in ${days} day${days === 1 ? '' : 's'}.`;
}

export const metadata = { title: 'Accounts' };

export default async function AccountsPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string }>;
  searchParams: Promise<{ connect?: string }>;
}) {
  const { workspaceId } = await params;
  const { connect } = await searchParams;
  await requireWorkspace(workspaceId);
  const accounts = await listAccounts(getDb(), workspaceId);
  const env = getEnv();
  const outcome = connect ? OUTCOMES[connect] : undefined;

  const platforms = (Object.keys(NAMES) as TargetPlatform[]).map((platform) => ({
    platform,
    account: accounts.find((a) => a.platform === platform),
    configured: Boolean(oauthApp(env, platform)),
  }));

  return (
    <Screen title="Accounts" description="Connected accounts, their scopes and their limits.">
      {outcome ? (
        <p
          className={
            outcome.tone === 'good'
              ? 'rounded-xl border border-good/40 bg-good/5 px-4 py-3 text-sm text-good'
              : 'rounded-xl border border-bad/40 bg-bad/5 px-4 py-3 text-sm text-bad'
          }
        >
          {outcome.message}
        </p>
      ) : null}

      <Card>
        <CardHeader
          title="Connections"
          note="Tokens are stored encrypted and never shown, here or anywhere else."
        />
        <ul className="flex flex-col gap-3 px-5 py-5">
          {platforms.map(({ platform, account, configured }) => (
            <li
              key={platform}
              className="flex flex-col gap-3 rounded-xl border border-line bg-raised px-4 py-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-ink">{NAMES[platform]}</p>
                  <p className="truncate text-xs text-faint">
                    {account ? account.displayName : 'Not connected'}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  {account ? (
                    <Badge tone={account.health === 'ok' ? 'good' : 'bad'}>
                      {account.health === 'ok' ? 'Connected' : 'Needs attention'}
                    </Badge>
                  ) : null}
                  {configured ? (
                    // A plain link, not a fetch: the platform's consent screen is a place the
                    // browser goes, not something this page can do on anyone's behalf.
                    <a
                      href={`/api/w/${workspaceId}/accounts/connect/${platform}`}
                      className="inline-flex h-11 items-center rounded-xl bg-accent px-4 text-sm font-medium text-accent-ink transition hover:opacity-90"
                    >
                      {account ? 'Reconnect' : `Connect ${NAMES[platform]}`}
                    </a>
                  ) : (
                    <span
                      className="rounded-xl border border-line px-4 py-2 text-sm text-muted"
                      title={`Set ${platform.toUpperCase()}_CLIENT_ID and _CLIENT_SECRET on the server`}
                    >
                      No app configured
                    </span>
                  )}
                </div>
              </div>

              {account ? (
                <p className="text-xs text-muted">
                  {expiry(account.tokenExpiresAt)} Scopes:{' '}
                  <span className="font-mono">{account.scopes?.join(', ') || 'unknown'}</span>
                </p>
              ) : null}

              {/* A list of what it can and cannot do, named as such, not bullets (WP51). */}
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs leading-5">
                <dt className="text-faint">Can</dt>
                <dd className="text-muted">{LIMITS[platform].can}</dd>
                <dt className="text-faint">Cannot</dt>
                <dd className="text-muted">{LIMITS[platform].cannot}</dd>
                <dt className="text-faint">Needs</dt>
                <dd className="text-muted">{LIMITS[platform].needs}</dd>
              </dl>
            </li>
          ))}
        </ul>
      </Card>
    </Screen>
  );
}
