import { listTrendsView } from '@cgp/core';
import { Screen } from '@/components/screen';
import { getDb } from '@/server/runtime';
import { requireWorkspace } from '@/server/session';
import { TrendsView } from './trends-view';

export const metadata = { title: 'Trend Radar' };

/** S-?? Trend Radar (WP61): what is rising right now, read once on arrival; the niche filter
 *  and bookmarking re-fetch from the client from here. */
export default async function TrendsPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  const { user } = await requireWorkspace(workspaceId);
  const initial = await listTrendsView(getDb(), workspaceId, user.id);

  return (
    <Screen
      title="Trend Radar"
      description="What is rising right now, broken into angles you can actually shoot."
    >
      <TrendsView workspaceId={workspaceId} initial={initial} />
    </Screen>
  );
}
