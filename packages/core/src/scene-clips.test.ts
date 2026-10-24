import { createLogger } from '@cgp/config';
import type { ObjectStore, StoredObject } from '@cgp/contracts';
import { describe, expect, it } from 'vitest';
import { MAX_CLIP_BYTES, storeSceneClip } from './scene-clips';

const log = createLogger({ service: 'test', level: 'silent' });

/** A fake store that records what it was asked to keep, so nothing leaves the machine. */
function fakeStore(): ObjectStore & { puts: Array<{ key: string; mimeType: string }> } {
  const puts: Array<{ key: string; mimeType: string }> = [];
  return {
    key: 'fake',
    puts,
    async put(key, data, mimeType): Promise<StoredObject> {
      puts.push({ key, mimeType });
      return { key, url: `https://store.test/${key}`, mimeType, bytes: data.byteLength };
    },
    async get() {
      throw new Error('unused');
    },
    publicUrl(key) {
      return `https://store.test/${key}`;
    },
  };
}

function box(type: string, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(8 + body.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, out.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(body, 8);
  return out;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, p) => sum + p.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/** A minimal MP4: ftyp, then moov > mvhd declaring a fixed duration (timescale 1000, so the
 *  duration field is the clip's length in milliseconds). */
function mp4Of(seconds: number): Uint8Array {
  const ftyp = box('ftyp', new Uint8Array(4));
  // version(1) + flags(3) at 0, creation_time at 4, modification_time at 8, then timescale
  // and duration — the layout packages/core/src/scene-clips.ts's mp4DurationSeconds reads.
  const mvhd = new Uint8Array(100);
  const view = new DataView(mvhd.buffer);
  view.setUint32(12, 1000); // timescale
  view.setUint32(16, Math.round(seconds * 1000)); // duration, in timescale units
  const moov = box('moov', box('mvhd', mvhd));
  return concat(ftyp, moov);
}

describe('storeSceneClip', () => {
  it('accepts a real MP4 and reports its real duration', async () => {
    const store = fakeStore();
    const result = await storeSceneClip({ store, log }, 'ws-1', mp4Of(8));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.durationSeconds).toBeCloseTo(8, 2);
    expect(result.mimeType).toBe('video/mp4');
    expect(store.puts).toHaveLength(1);
    expect(store.puts[0]?.key).toMatch(/^ws-1\/storyboards\/clips\/.+\.mp4$/);
  });

  it('refuses anything that is not really an MP4, regardless of what it is called', async () => {
    const store = fakeStore();
    const result = await storeSceneClip({ store, log }, 'ws-1', new TextEncoder().encode('hello'));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0]?.message).toContain('MP4');
    expect(store.puts).toHaveLength(0);
  });

  it('refuses an empty file', async () => {
    const store = fakeStore();
    const result = await storeSceneClip({ store, log }, 'ws-1', new Uint8Array(0));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0]?.message).toContain('empty');
  });

  it('refuses a clip over the size cap without storing it', async () => {
    const store = fakeStore();
    const oversized = new Uint8Array(MAX_CLIP_BYTES + 1);
    const result = await storeSceneClip({ store, log }, 'ws-1', oversized);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0]?.message).toContain('50 MB');
    expect(store.puts).toHaveLength(0);
  });
});
