import { listAccounts } from '@cgp/core';
import { Card, CardHeader, EmptyState } from '@cgp/ui';
import { Screen } from '@/components/screen';
import { getDb } from '@/server/runtime';
import { requireWorkspace } from '@/server/session';

const NAMES = { instagram: 'Instagram', linkedin: 'LinkedIn' } as const;

export default async function AccountsPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  await requireWorkspace(workspaceId);
  const accounts = await listAccounts(getDb(), workspaceId);

  return (
    <Screen title="Accounts" description="Connected accounts, their scopes and their limits.">
      <Card>
        <CardHeader
          title="Connections"
          note={accounts.length > 0 ? 'Tokens are stored encrypted and never shown.' : undefined}
        />
        {accounts.length === 0 ? (
          <EmptyState
            title="No accounts connected"
            description="Instagram and LinkedIn connect here. Until the connect flow exists, run pnpm --filter @cgp/worker accounts:import with this workspace's id."
          />
        ) : (
          <ul className="flex flex-col gap-2 px-5 py-5">
            {accounts.map((account) => (
              <li
                key={account.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-line bg-raised px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-ink">{NAMES[account.platform]}</p>
                  <p className="truncate text-xs text-faint">{account.displayName}</p>
                </div>
                <span
                  className={
                    account.health === 'ok'
                      ? 'rounded-full border border-good/40 px-3 py-1 text-xs text-good'
                      : 'rounded-full border border-bad/40 px-3 py-1 text-xs text-bad'
                  }
                >
                  {account.health === 'ok' ? 'Connected' : 'Needs attention'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </Screen>
  );
}
