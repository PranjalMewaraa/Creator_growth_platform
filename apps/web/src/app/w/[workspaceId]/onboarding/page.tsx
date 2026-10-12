import { PROFILE_OPTIONS, profileHistory } from '@cgp/core';
import { getDb } from '@/server/runtime';
import { requireWorkspace } from '@/server/session';
import { OnboardingFlow } from './onboarding-flow';

/** FR-ON: one question per screen. Re-running it starts from the current profile. */
export const metadata = { title: 'About your content' };

export default async function OnboardingPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  const { workspace } = await requireWorkspace(workspaceId);
  const [latest] = await profileHistory(getDb(), workspaceId);

  return (
    <OnboardingFlow
      workspaceId={workspaceId}
      workspaceName={workspace.name}
      options={PROFILE_OPTIONS}
      initial={latest?.profile ?? null}
    />
  );
}
