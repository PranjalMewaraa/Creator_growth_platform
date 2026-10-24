import { randomUUID } from 'node:crypto';
import type { Logger } from '@cgp/config';
import type { ObjectStore } from '@cgp/contracts';
import type { InputIssue } from './generators/registry';

/**
 * A clip a creator uploads directly for one Storyboard scene (WP68), skipping generation for
 * it entirely. Deliberately smaller than `storeUpload`: no Instagram-frame copies, no
 * moderation check — `ModerationAdapter` has no video method today (only `checkText`/
 * `checkImage`), so an uploaded clip is stored unchecked. A known gap, not a silent one.
 */

export const MAX_CLIP_BYTES = 50 * 1024 * 1024;

export type SceneClipResult =
  | { ok: true; key: string; url: string; mimeType: string; bytes: number; durationSeconds: number }
  | { ok: false; reason: 'invalid_input'; issues: InputIssue[] };

interface Box {
  type: string;
  start: number;
  end: number;
}

/** The boxes directly inside the given range. MP4 is a tree of length-prefixed boxes. A local
 *  copy of the walk `packages/adapters/src/video/mp4.ts` already does — `packages/core` cannot
 *  depend on `packages/adapters` (the same layering rule `models.ts` documents), and
 *  `publishing.ts`'s `sniffImage` already establishes the convention of each layer owning its
 *  own small sniff helper rather than sharing one. */
function boxes(view: DataView, from: number, to: number): Box[] {
  const found: Box[] = [];
  let at = from;
  while (at + 8 <= to) {
    const size = view.getUint32(at);
    const type = String.fromCharCode(
      view.getUint8(at + 4),
      view.getUint8(at + 5),
      view.getUint8(at + 6),
      view.getUint8(at + 7),
    );
    const length = size === 0 ? to - at : size === 1 ? Number(view.getBigUint64(at + 8)) : size;
    if (length < 8) return found;
    found.push({ type, start: at + (size === 1 ? 16 : 8), end: Math.min(at + length, to) });
    at += length;
  }
  return found;
}

/** Whether this is really an MP4, and how long it runs — undefined for anything else. */
function mp4DurationSeconds(data: Uint8Array): number | undefined {
  if (data.byteLength < 16) return undefined;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const top = boxes(view, 0, data.byteLength);
  if (!top.some((box) => box.type === 'ftyp')) return undefined;
  const moov = top.find((box) => box.type === 'moov');
  if (!moov) return undefined;
  const mvhd = boxes(view, moov.start, moov.end).find((box) => box.type === 'mvhd');
  if (!mvhd) return 0;
  const version = view.getUint8(mvhd.start);
  const at = mvhd.start + 4;
  const timescale = version === 1 ? view.getUint32(at + 16) : view.getUint32(at + 8);
  const duration = version === 1 ? Number(view.getBigUint64(at + 20)) : view.getUint32(at + 12);
  return timescale > 0 ? Number((duration / timescale).toFixed(3)) : 0;
}

export async function storeSceneClip(
  deps: { store: ObjectStore; log: Logger },
  workspaceId: string,
  data: Uint8Array,
): Promise<SceneClipResult> {
  const invalid = (message: string): SceneClipResult => ({
    ok: false,
    reason: 'invalid_input',
    issues: [{ path: 'file', message }],
  });
  if (data.byteLength === 0) return invalid('The file is empty');
  if (data.byteLength > MAX_CLIP_BYTES) return invalid('Clips can be at most 50 MB');
  const durationSeconds = mp4DurationSeconds(data);
  if (durationSeconds === undefined) return invalid('Only MP4 clips are supported');

  const key = `${workspaceId}/storyboards/clips/${randomUUID()}.mp4`;
  const stored = await deps.store.put(key, data, 'video/mp4');
  return { ok: true, ...stored, durationSeconds };
}
