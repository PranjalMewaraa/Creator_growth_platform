import { barColour, listAccounts } from '@cgp/core';
import { Screen } from '@/components/screen';
import { getDb, getEnv } from '@/server/runtime';
import { requireWorkspace } from '@/server/session';
import { Composer } from './composer';

export default async function ComposePage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  await requireWorkspace(workspaceId);
  const [accounts, bars] = await Promise.all([
    listAccounts(getDb(), workspaceId),
    barColour(getDb(), workspaceId),
  ]);

  return (
    <Screen title="New post" description="Write it, add an image, pick where it goes.">
      <Composer
        workspaceId={workspaceId}
        accounts={accounts.map(({ id, platform, displayName }) => ({ id, platform, displayName }))}
        live={getEnv().PUBLISHING === 'real'}
        barColour={bars}
      />
    </Screen>
  );
}
