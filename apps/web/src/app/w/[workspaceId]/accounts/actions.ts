'use server';

import type { TargetPlatform } from '@cgp/contracts';
import { findSharedDemoAccount, upsertSocialAccount } from '@cgp/db';
import { redirect } from 'next/navigation';
import { getDb, getEnv } from '@/server/runtime';
import { requireWorkspace } from '@/server/session';

/**
 * Borrows the team's own connected account into this workspace (WP52): a demo-taker who is
 * not a registered tester on either developer-mode app cannot complete real OAuth, so this
 * gives them a second way to see a real post go out — the team's account, not their own.
 *
 * The ciphertext is copied as-is rather than decrypted and re-encrypted: one
 * `TOKEN_ENCRYPTION_KEY` seals every row in a deployment, so the sealed bytes are already
 * valid under the key the borrowing workspace will read them with. Nothing here ever sees
 * the token in the clear.
 */
export async function connectDemoAccountAction(
  workspaceId: string,
  platform: TargetPlatform,
): Promise<void> {
  await requireWorkspace(workspaceId);
  const env = getEnv();
  if (env.DEMO_ACCOUNT_SHARING !== 'on')
    redirect(`/w/${workspaceId}/accounts?connect=not_configured`);

  const source = await findSharedDemoAccount(getDb(), platform);
  if (!source) redirect(`/w/${workspaceId}/accounts?connect=demo_unavailable`);

  await upsertSocialAccount(getDb(), {
    workspaceId,
    platform,
    externalId: source.externalId,
    displayName: source.displayName,
    scopes: source.scopes,
    tokenCiphertext: source.tokenCiphertext,
    tokenExpiresAt: source.tokenExpiresAt,
    sharedDemo: true,
  });
  redirect(`/w/${workspaceId}/accounts?connect=demo_connected`);
}
