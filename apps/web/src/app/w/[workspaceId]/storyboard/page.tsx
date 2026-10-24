import { listStoryboards } from '@cgp/db';
import { Screen } from '@/components/screen';
import { getDb } from '@/server/runtime';
import { requireWorkspace } from '@/server/session';
import { StoryboardWorkspace } from './storyboard-workspace';

export const metadata = { title: 'Storyboard' };

/** Storyboard (WP67 reskin): named, revisitable boards of independently-authored scenes, each
 *  filmed with Gemini Omni. A distinct screen from the AI-planned `storyboard` generator Studio's
 *  Video kind already offers — this is a board a creator builds shot by shot. */
export default async function StoryboardPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  await requireWorkspace(workspaceId);
  const boards = await listStoryboards(getDb(), workspaceId);

  return (
    <Screen title="Storyboard" description="Build a sequence. Shape every shot. Bring it together.">
      <StoryboardWorkspace workspaceId={workspaceId} initialBoards={boards} />
    </Screen>
  );
}
