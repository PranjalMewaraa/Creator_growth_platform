'use server';

import { saveProfile, type ProfileInput } from '@cgp/core';
import { revalidatePath } from 'next/cache';
import { getDb } from '@/server/runtime';
import { requireWorkspace } from '@/server/session';

export type SaveProfileState =
  | { ok: true; version: number; changed: boolean }
  | { ok: false; issues: Array<{ path: string; message: string }> };

/** Saves the profile as version N+1 (or nothing, when nothing changed). */
export async function saveProfileAction(
  workspaceId: string,
  input: ProfileInput,
): Promise<SaveProfileState> {
  await requireWorkspace(workspaceId);
  const result = await saveProfile(getDb(), workspaceId, input);
  if (!result.ok) return { ok: false, issues: result.issues };
  revalidatePath(`/w/${workspaceId}`, 'layout');
  return { ok: true, version: result.profile.version, changed: result.changed };
}
