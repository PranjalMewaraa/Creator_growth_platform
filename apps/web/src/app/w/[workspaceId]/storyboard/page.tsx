import { generators, listTemplates, profileHistory, recentGenerationJobs } from '@cgp/core';
import { brandKits, scoped } from '@cgp/db';
import { listArt } from '@/server/art';
import { getDb } from '@/server/runtime';
import { requireWorkspace } from '@/server/session';
import { Studio } from '../studio/studio';

export const metadata = { title: 'Storyboard' };

/** Storyboard (WP64 reskin): its own rail stop, but the flow it opens into is Studio's video
 *  kind — draw a storyboard, review it, commit to a reel — already built in full there (WP50).
 *  A second copy of that flow would just be the same code under a different name, so this page
 *  is Studio itself with the kind picker skipped and `video` forced, rather than a fork. */
export default async function StoryboardPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string }>;
  searchParams: Promise<{ job?: string; intent?: string }>;
}) {
  const { workspaceId } = await params;
  const { job, intent } = await searchParams;
  const { workspace } = await requireWorkspace(workspaceId);
  const db = getDb();
  const [[profile], [kit], jobs] = await Promise.all([
    profileHistory(db, workspaceId),
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
      initialKind="video"
      initialIntent={intent ?? null}
      profileTone={profile?.profile.tone ?? null}
      brandColours={kit?.colors ?? []}
      templates={templates}
      art={listArt()}
    />
  );
}
