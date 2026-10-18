import { generators, listTemplates, profileHistory, recentGenerationJobs } from '@cgp/core';
import { brandKits, scoped } from '@cgp/db';
import { listArt } from '@/server/art';
import { getDb } from '@/server/runtime';
import { requireWorkspace } from '@/server/session';
import { Studio } from './studio';

export const metadata = { title: 'Studio' };

export default async function StudioPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string }>;
  searchParams: Promise<{ job?: string; kind?: string; intent?: string }>;
}) {
  const { workspaceId } = await params;
  const { job, kind, intent } = await searchParams;
  const { workspace } = await requireWorkspace(workspaceId);
  const db = getDb();
  const [[profile], [kit], jobs] = await Promise.all([
    profileHistory(db, workspaceId),
    // The newest kit: its colours are offered first when a text layer is coloured.
    scoped(db, workspaceId).select(brandKits, {
      orderBy: (t, order) => order.desc(t.version),
      limit: 1,
    }),
    recentGenerationJobs(db, workspaceId),
  ]);
  const templates = await listTemplates(db, generators);

  return (
    <Studio
      workspaceId={workspaceId}
      credits={workspace.creditBalance}
      videoSeconds={workspace.videoSecondsBalance}
      ready={{ profile: Boolean(profile), brandKit: Boolean(kit) }}
      initialJobs={jobs}
      initialJobId={job ?? null}
      initialKind={kind ?? null}
      initialIntent={intent ?? null}
      profileTone={profile?.profile.tone ?? null}
      brandColours={kit?.colors ?? []}
      templates={templates}
      art={listArt()}
    />
  );
}
