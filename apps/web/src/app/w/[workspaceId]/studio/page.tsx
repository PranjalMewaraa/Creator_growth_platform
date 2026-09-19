import { profileHistory, recentGenerationJobs } from '@cgp/core';
import { brandKits, scoped } from '@cgp/db';
import { listArt } from '@/server/art';
import { getDb } from '@/server/runtime';
import { requireWorkspace } from '@/server/session';
import { Studio } from './studio';

export default async function StudioPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string }>;
  searchParams: Promise<{ job?: string }>;
}) {
  const { workspaceId } = await params;
  const { job } = await searchParams;
  const { workspace } = await requireWorkspace(workspaceId);
  const db = getDb();
  const [[profile], [kit], jobs] = await Promise.all([
    profileHistory(db, workspaceId),
    scoped(db, workspaceId).select(brandKits, { limit: 1 }),
    recentGenerationJobs(db, workspaceId),
  ]);

  return (
    <Studio
      workspaceId={workspaceId}
      credits={workspace.creditBalance}
      ready={{ profile: Boolean(profile), brandKit: Boolean(kit) }}
      initialJobs={jobs}
      initialJobId={job ?? null}
      profileTone={profile?.profile.tone ?? null}
      art={listArt()}
    />
  );
}
