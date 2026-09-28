import type { Logger } from '@cgp/config';
import type { ModerationAdapter, ObjectStore } from '@cgp/contracts';
import {
  findRendition,
  outputs,
  renditionsFor,
  saveRendition,
  scoped,
  type Database,
} from '@cgp/db';

import { instagramKey, storeUpload, type UploadResult } from './publishing';

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

/**
 * Instagram is the only platform whose post needs a cut of its own, so a post copy is filed
 * under it; LinkedIn takes the original that sits beside it.
 */
const POST_PLATFORM = 'instagram' as const;

/** What a cached post copy was made from. A different source means a different copy. */
interface PostRenditionSpec {
  sourceKey: string;
}

/** The upload shape, rebuilt from a cached key: the frames are siblings of it by name. */
function uploadFromKey(store: ObjectStore, key: string): Extract<UploadResult, { ok: true }> {
  const url = store.publicUrl(key);
  return {
    ok: true,
    key,
    url,
    mimeType: key.endsWith('.png') ? 'image/png' : 'image/jpeg',
    bytes: 0,
    instagramUrl: store.publicUrl(instagramKey(key)),
    instagramUrls: {
      portrait: store.publicUrl(instagramKey(key, 'portrait')),
      square: store.publicUrl(instagramKey(key, 'square')),
    },
  };
}

export type AttachResult =
  | {
      ok: true;
      /** The stored copy to post, with its Instagram frames. Null when the output is words. */
      upload: Extract<UploadResult, { ok: true }> | null;
      /** The caption the Studio wrote, when this output is words rather than a picture. */
      text: string;
      /** For the publication's lineage: which output this post came from. */
      sourceOutputId: string;
      /** Whether this came from the cache rather than being cut again (WP32). */
      cached: boolean;
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
    return { ok: true, upload: null, text, sourceOutputId: output.id, cached: false };
  }
  if (output.kind === 'video') return { ok: false, reason: 'not_postable', kind: output.kind };

  // The composited layer if there is one, because that is the picture the creator approved.
  // Both carry the key they were stored under, which is what the store wants. Picking the key
  // back out of a public URL would mean knowing how one store spells its URLs, and that shape
  // is not allowed past the adapters (invariant 3).
  const [layer] = await renditionsFor(deps.db, workspaceId, [output.id]);
  const key = layer ? layer.storageKey : output.storageKey;
  if (!key) return { ok: false, reason: 'invalid_input', message: 'That output has no picture' };

  // Cached from last time (WP32). The same picture cut to the same frames is the same file,
  // so a second look at a post reuses it rather than paying for the cut, the storage and the
  // safety check again. The source key is the whole of what the copy depends on: draw a new
  // text layer and the key changes with it, which is what makes this safe to trust.
  // Filed under Instagram because Instagram is the only platform that needs a cut: LinkedIn
  // posts the picture as uploaded, and takes the same original this copy is built around.
  const cached = await findRendition(deps.db, workspaceId, output.id, POST_PLATFORM, 'post');
  if (cached && (cached.spec as PostRenditionSpec).sourceKey === key) {
    deps.log.info({ outputId: output.id }, 'post copy reused from the rendition cache');
    return {
      ok: true,
      upload: uploadFromKey(deps.store, cached.storageKey),
      text,
      sourceOutputId: output.id,
      cached: true,
    };
  }

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
  // Derived once, cached (plan section 3). Keyed on the source it was cut from, so a new text
  // layer over the same output makes the cache miss instead of serving the old picture.
  await saveRendition(deps.db, workspaceId, {
    outputId: output.id,
    platform: POST_PLATFORM,
    kind: 'post',
    spec: { sourceKey: key } satisfies PostRenditionSpec,
    storageKey: upload.key,
  });
  return { ok: true, upload, text, sourceOutputId: output.id, cached: false };
}
