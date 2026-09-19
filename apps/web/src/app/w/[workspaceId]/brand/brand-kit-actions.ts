'use server';

import { saveBrandKit, type BrandKitInput } from '@cgp/core';
import { revalidatePath } from 'next/cache';
import { getDb, getProviders } from '@/server/runtime';
import { requireWorkspace } from '@/server/session';

export type SaveBrandKitState =
  | { ok: true; version: number; changed: boolean }
  | { ok: false; issues: Array<{ path: string; message: string }> };

export async function saveBrandKitAction(
  workspaceId: string,
  input: BrandKitInput,
): Promise<SaveBrandKitState> {
  await requireWorkspace(workspaceId);
  const result = await saveBrandKit(
    { db: getDb(), store: getProviders().store },
    workspaceId,
    input,
  );
  if (!result.ok) return { ok: false, issues: result.issues };
  revalidatePath(`/w/${workspaceId}`, 'layout');
  return { ok: true, version: result.version, changed: result.changed };
}
