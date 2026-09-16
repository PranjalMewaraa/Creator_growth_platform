'use server';

import { createWorkspace } from '@cgp/db';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { getDb } from '@/server/runtime';
import { requireUser } from '@/server/session';

const schema = z.object({
  name: z.string().trim().min(1, 'Give the workspace a name.').max(80),
  timezone: z.string().trim().min(1),
});

export interface SetupState {
  error?: string;
}

export async function createWorkspaceAction(
  _state: SetupState,
  formData: FormData,
): Promise<SetupState> {
  const user = await requireUser();
  const parsed = schema.safeParse({
    name: formData.get('name'),
    timezone: formData.get('timezone'),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check the form and try again.' };
  }

  const workspace = await createWorkspace(getDb(), {
    name: parsed.data.name,
    timezone: parsed.data.timezone,
    ownerUserId: user.id,
  });
  redirect(`/w/${workspace.id}`);
}
