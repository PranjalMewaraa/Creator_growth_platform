import { randomUUID } from 'node:crypto';
import type { Logger } from '@cgp/config';
import type { ModerationAdapter, ModerationCategory, ObjectStore } from '@cgp/contracts';
import type { InputIssue } from './generators/registry';
import { MAX_UPLOAD_BYTES, sniffImage } from './publishing';

/**
 * A reference image a creator uploads for image generation to stay consistent with (WP60):
 * the model's own continuity feature (`ImageRequest.references`), already used internally by
 * the storyboard to keep its own later frames in the first one's kitchen, now also reachable
 * from a picture the creator hands it directly. Only `image`/`thumbnail` take one — Veo has no
 * equivalent for video, so this is never offered there.
 *
 * Deliberately smaller than `storeUpload`: no Instagram-frame copies, since a reference is read
 * by a model, never posted.
 */
export type ReferenceImageResult =
  | { ok: true; key: string; url: string; mimeType: string; bytes: number }
  | { ok: false; reason: 'invalid_input'; issues: InputIssue[] }
  | { ok: false; reason: 'blocked'; category: ModerationCategory }
  | { ok: false; reason: 'moderation_unavailable' };

export async function storeReferenceImage(
  deps: { store: ObjectStore; moderation: ModerationAdapter; log: Logger },
  workspaceId: string,
  data: Uint8Array,
): Promise<ReferenceImageResult> {
  const invalid = (message: string): ReferenceImageResult => ({
    ok: false,
    reason: 'invalid_input',
    issues: [{ path: 'file', message }],
  });
  if (data.byteLength === 0) return invalid('The file is empty');
  if (data.byteLength > MAX_UPLOAD_BYTES) return invalid('Images can be at most 8 MB');
  const type = sniffImage(data);
  if (!type) return invalid('Only JPEG and PNG images are supported');

  try {
    const verdict = await deps.moderation.checkImage({ data, mimeType: type.mimeType });
    if (!verdict.allowed) {
      return { ok: false, reason: 'blocked', category: verdict.flagged[0]?.category ?? 'other' };
    }
  } catch (err) {
    deps.log.warn({ err }, 'image moderation unavailable, reference upload refused');
    return { ok: false, reason: 'moderation_unavailable' };
  }

  const key = `${workspaceId}/references/${randomUUID()}.${type.extension}`;
  const stored = await deps.store.put(key, data, type.mimeType);
  return { ok: true, ...stored };
}
