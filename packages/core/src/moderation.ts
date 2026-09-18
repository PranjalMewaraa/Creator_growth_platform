import type { ModerationAdapter, ModerationCategory, ModerationVerdict } from '@cgp/contracts';
import type { Logger } from '@cgp/config';
import { moderationEvents, scoped, type Database } from '@cgp/db';

export type PreCheck =
  | { ok: true }
  | { ok: false; reason: 'blocked'; category: ModerationCategory }
  | { ok: false; reason: 'moderation_unavailable' };

/**
 * Invariant 10: the compiled prompt is checked before anything is held or dispatched. Every
 * verdict is recorded. If the check itself fails the dispatch is refused: an unchecked prompt
 * never reaches a provider, and the user can simply try again.
 */
export async function preCheckPrompt(
  deps: { db: Database; moderation: ModerationAdapter; log: Logger },
  workspaceId: string,
  prompt: { id: string; text: string },
): Promise<PreCheck> {
  let verdict: ModerationVerdict;
  try {
    verdict = await deps.moderation.checkText(prompt.text);
  } catch (err) {
    deps.log.warn({ err, compiledPromptId: prompt.id }, 'moderation unavailable, dispatch refused');
    return { ok: false, reason: 'moderation_unavailable' };
  }

  const category = verdict.flagged[0]?.category;
  await scoped(deps.db, workspaceId).insert(moderationEvents, {
    subjectType: 'compiled_prompt',
    subjectId: prompt.id,
    verdict: verdict.allowed ? 'allowed' : 'blocked',
    category: verdict.allowed ? null : (category ?? 'other'),
  });
  if (verdict.allowed) return { ok: true };

  deps.log.info({ compiledPromptId: prompt.id, category }, 'compiled prompt blocked');
  return { ok: false, reason: 'blocked', category: category ?? 'other' };
}
