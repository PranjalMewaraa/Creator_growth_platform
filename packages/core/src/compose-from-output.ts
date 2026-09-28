import type { Logger } from '@cgp/config';
import type { ModerationAdapter, ObjectStore } from '@cgp/contracts';
import { outputs, renditionsFor, scoped, type Database } from '@cgp/db';

import { storeUpload, type UploadResult } from './publishing';

/**
 * Taking something the Studio made into a post (S-13, WP33). Until this existed, a generated
 * image had to be downloaded and uploaded again by hand, which is the seam the demo would
 * have shown.
 *
 * The output is copied into the composer's own upload area rather than posted from where it
 * sits, because a post needs things the generator never made: Instagram's 4:5 and 1:1 copies,
 * cut and barred in the brand colour. Running it through the same path as a hand upload means
 * one set of rules decides what is postable, not two that can drift apart.
 */

export type AttachResult =
  | {
      ok: true;
      /** The stored copy to post, with its Instagram frames. Null when the output is words. */
      upload: Extract<UploadResult, { ok: true }> | null;
      /** The caption the Studio wrote, when this output is words rather than a picture. */
      text: string;
      /** For the publication's lineage: which output this post came from. */
      sourceOutputId: string;
    }
  | { ok: false; reason: 'not_found' }
  /** A reel. The publishers post images; video publishing is not built (see WP29, WP30). */
  | { ok: false; reason: 'not_postable'; kind: string }
  | { ok: false; reason: 'invalid_input'; message: string }
  | { ok: false; reason: 'blocked'; category: string }
  | { ok: false; reason: 'moderation_unavailable' };

export interface AttachDeps {
  db: Database;
  store: ObjectStore;
  moderation: ModerationAdapter;
  log: Logger;
}

export async function attachOutputToPost(
  deps: AttachDeps,
  workspaceId: string,
  outputId: string,
): Promise<AttachResult> {
  const [output] = await scoped(deps.db, workspaceId).select(outputs, {
    where: (t, op) => op.eq(t.id, outputId),
    limit: 1,
  });
  if (!output) return { ok: false, reason: 'not_found' };

  const metadata = (output.metadata ?? {}) as Record<string, unknown>;
  const text = typeof metadata.text === 'string' ? metadata.text : '';

  // Words alone: nothing to attach, but the caption comes across.
  if (output.kind === 'hook' || output.kind === 'caption') {
    return { ok: true, upload: null, text, sourceOutputId: output.id };
  }
  if (output.kind === 'video') return { ok: false, reason: 'not_postable', kind: output.kind };

  // The composited layer if there is one, because that is the picture the creator approved.
  // Both carry the key they were stored under, which is what the store wants. Picking the key
  // back out of a public URL would mean knowing how one store spells its URLs, and that shape
  // is not allowed past the adapters (invariant 3).
  const [layer] = await renditionsFor(deps.db, workspaceId, [output.id]);
  const key = layer ? layer.storageKey : output.storageKey;
  if (!key) return { ok: false, reason: 'invalid_input', message: 'That output has no picture' };

  let data: Uint8Array;
  try {
    data = await deps.store.get(key);
  } catch (err) {
    deps.log.warn({ err, key }, 'output media could not be read');
    return { ok: false, reason: 'invalid_input', message: 'That picture could not be read' };
  }

  // The same path a hand upload takes: sniffed, checked, and cut to Instagram's frames. The
  // check runs again even though the generator's output was checked when it was made, because
  // what is posted is what is checked, and a layer may have been drawn over it since.
  const upload = await storeUpload(deps, workspaceId, data);
  if (!upload.ok) {
    return upload.reason === 'blocked'
      ? { ok: false, reason: 'blocked', category: upload.category }
      : upload.reason === 'moderation_unavailable'
        ? { ok: false, reason: 'moderation_unavailable' }
        : {
            ok: false,
            reason: 'invalid_input',
            message: upload.issues[0]?.message ?? 'That picture could not be used',
          };
  }
  return { ok: true, upload, text, sourceOutputId: output.id };
}
