import { barColour, listAccounts } from '@cgp/core';
import { scoped, workspaceProfiles } from '@cgp/db';
import { getDb, getEnv } from '@/server/runtime';
import { requireWorkspace } from '@/server/session';
import { ComposerLoader } from './composer-loader';

/** "Behind the scenes" becomes #BehindTheScenes. */
function hashtag(pillar: string) {
  const words = pillar.match(/[\p{L}\p{N}]+/gu) ?? [];
  return words.length ? `#${words.map((w) => w[0]?.toUpperCase() + w.slice(1)).join('')}` : null;
}

export const metadata = { title: 'Create post' };

export default async function ComposePage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  await requireWorkspace(workspaceId);
  const db = getDb();
  const [accounts, bars, [profile]] = await Promise.all([
    listAccounts(db, workspaceId),
    barColour(db, workspaceId),
    scoped(db, workspaceId).select(workspaceProfiles, {
      orderBy: (t, order) => order.desc(t.version),
      limit: 1,
    }),
  ]);

  return (
    <ComposerLoader
      workspaceId={workspaceId}
      accounts={accounts.map(({ id, platform, displayName }) => ({ id, platform, displayName }))}
      live={getEnv().PUBLISHING === 'real'}
      barColour={bars}
      hashtags={(profile?.pillars ?? []).map(hashtag).filter((t): t is string => t !== null)}
    />
  );
}
