import type {
  MediaBytes,
  ModerationAdapter,
  ModerationCategory,
  ModerationVerdict,
} from '@cgp/contracts';
import type { Logger } from '@cgp/config';
import { markJobModerating, moderationEvents, scoped, type Database } from '@cgp/db';

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

/** What a generator made, before any of it is kept. Media is checked picture by picture. */
export interface GeneratedContent {
  text?: string;
  media?: MediaBytes[];
}

/** The check could not run, so nothing may be released. Refunded in full, like any failure. */
export class ModerationUnavailable extends Error {
  override readonly name = 'ModerationUnavailable';
  constructor() {
    super('The safety check is unavailable, so nothing was released');
  }
}

/**
 * The post check (plan section 6, week 4): what a provider returned is checked before it is
 * stored, so a blocked output never reaches storage, a public URL or the creator. The job sits
 * in MODERATING while this runs, which is the "Checking" state with copy locked.
 *
 * Recorded against the job rather than the output, because a blocked output is never kept.
 * Returns the category to block on, or nothing when everything passed; a check that cannot run
 * throws, and the job is refunded in full.
 */
export async function postCheckOutput(
  deps: { db: Database; moderation: ModerationAdapter; log: Logger },
  job: { id: string; workspaceId: string },
  content: GeneratedContent,
): Promise<ModerationCategory | undefined> {
  const text = content.text?.trim();
  const media = content.media ?? [];
  if (!text && media.length === 0) return undefined;

  await markJobModerating(deps.db, job.id);

  let verdicts: ModerationVerdict[];
  try {
    verdicts = await Promise.all([
      ...(text ? [deps.moderation.checkText(text)] : []),
      ...media.map((item) => deps.moderation.checkImage(item)),
    ]);
  } catch (err) {
    deps.log.warn({ err, jobId: job.id }, 'moderation unavailable, output not released');
    throw new ModerationUnavailable();
  }

  const flagged = verdicts.find((verdict) => !verdict.allowed);
  const category = flagged?.flagged[0]?.category;
  await scoped(deps.db, job.workspaceId).insert(moderationEvents, {
    subjectType: 'job',
    subjectId: job.id,
    verdict: flagged ? 'blocked' : 'allowed',
    category: flagged ? (category ?? 'other') : null,
  });
  if (!flagged) return undefined;

  deps.log.info({ jobId: job.id, category }, 'output blocked');
  return category ?? 'other';
}
