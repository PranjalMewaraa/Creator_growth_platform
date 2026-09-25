import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isAdapterError } from '@cgp/contracts';
import { describe, expect, it } from 'vitest';
import { createFakeVideo } from '../fakes';
import { createVideoAdapters } from '../registry';
import { mp4Info } from './mp4';
import { createStubVideo } from './stub';
import { createVeoVideo } from './veo';

const clip = readFileSync(fileURLToPath(new URL('../../fixtures/fake-clip.mp4', import.meta.url)));

const request = {
  prompt: 'A cup of chai on a table by a window, slow push in',
  aspectRatio: '9:16' as const,
  durationSeconds: 8,
  resolution: '1080p' as const,
};

/** A Veo adapter whose every call is answered from this list, in order. */
function veoWith(responses: Array<{ status?: number; body?: unknown }>) {
  const calls: Array<{ url: string; body: unknown }> = [];
  const adapter = createVeoVideo({
    key: 'veo-3.1-lite',
    project: 'test-project',
    location: 'us-central1',
    model: 'veo-3.1-lite-generate-001',
    authHeaders: () => Promise.resolve({ authorization: 'Bearer test' }),
    fetch: ((url: string, init: { body: string }) => {
      calls.push({ url, body: JSON.parse(init.body) as unknown });
      const next = responses.shift() ?? { body: {} };
      return Promise.resolve(
        new Response(JSON.stringify(next.body ?? {}), { status: next.status ?? 200 }),
      );
    }) as unknown as typeof fetch,
  });
  return { adapter, calls };
}

describe('mp4Info', () => {
  it('reads the frame and duration out of a real clip', () => {
    const info = mp4Info(new Uint8Array(clip));
    expect(info).toMatchObject({ width: 180, height: 320 });
    expect(info?.durationSeconds).toBeCloseTo(8, 0);
  });

  it('returns nothing for bytes that are not an MP4', () => {
    expect(mp4Info(new Uint8Array([1, 2, 3, 4]))).toBeUndefined();
    expect(mp4Info(new Uint8Array(clip).subarray(0, 8))).toBeUndefined();
  });
});

describe('the Veo adapter', () => {
  it('submits the request the plan prices: budget tier, one sample, no audio', async () => {
    const { adapter, calls } = veoWith([{ body: { name: 'operations/abc' } }]);
    const { operationId } = await adapter.submit({ ...request, negativePrompt: 'text, logos' });

    expect(operationId).toBe('operations/abc');
    const call = calls[0];
    expect(call?.url).toContain('veo-3.1-lite-generate-001:predictLongRunning');
    expect(call?.body).toMatchObject({
      instances: [{ prompt: request.prompt }],
      parameters: {
        aspectRatio: '9:16',
        durationSeconds: 8,
        resolution: '1080p',
        sampleCount: 1,
        negativePrompt: 'text, logos',
        // Voiceover and music are added in the render, and audio bills higher.
        generateAudio: false,
      },
    });
  });

  it('reports an operation still running', async () => {
    const { adapter } = veoWith([{ body: { done: false } }]);
    expect(await adapter.poll('operations/abc')).toEqual({ status: 'running' });
  });

  it('returns the clip, measured from its own header', async () => {
    const { adapter, calls } = veoWith([
      {
        body: {
          done: true,
          response: { videos: [{ bytesBase64Encoded: clip.toString('base64') }] },
        },
      },
    ]);
    const result = await adapter.poll('operations/abc');
    if (result.status !== 'done') throw new Error('expected a clip');
    expect(result.clip).toMatchObject({ mimeType: 'video/mp4', width: 180, height: 320 });
    expect(result.clip.durationSeconds).toBeCloseTo(8, 0);
    expect(calls[0]?.body).toEqual({ operationName: 'operations/abc' });
  });

  it('reports a refused clip as failed, not as an error to retry', async () => {
    const { adapter } = veoWith([
      {
        body: {
          done: true,
          response: { raiMediaFilteredCount: 1, raiMediaFilteredReasons: ['violence'] },
        },
      },
    ]);
    const result = await adapter.poll('operations/abc');
    expect(result).toMatchObject({
      status: 'failed',
      error: { code: 'SAFETY_FILTERED', category: 'terminal' },
    });
  });

  it('reports the provider’s own error as failed', async () => {
    const { adapter } = veoWith([
      { body: { done: true, error: { code: 3, message: 'bad argument' } } },
    ]);
    const result = await adapter.poll('operations/abc');
    if (result.status !== 'failed') throw new Error('expected a failure');
    expect(result.error.category).toBe('terminal');
    // The provider's own words never cross the boundary (invariant 3).
    expect(result.error.message).not.toContain('bad argument');
  });

  it('maps HTTP status to what a caller should do about it', async () => {
    for (const [status, category] of [
      [429, 'quota'],
      [503, 'retriable'],
      [400, 'terminal'],
    ] as const) {
      const { adapter } = veoWith([{ status, body: { error: 'nope' } }]);
      const err: unknown = await adapter.submit(request).then(
        () => undefined,
        (e: unknown) => e,
      );
      expect(isAdapterError(err) && err.category).toBe(category);
      expect(isAdapterError(err) && err.message).toBe(`veo request failed with HTTP ${status}`);
    }
  });

  it('treats an accepted request with no operation as worth retrying', async () => {
    const { adapter } = veoWith([{ body: {} }]);
    const err: unknown = await adapter.submit(request).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(isAdapterError(err) && err.code).toBe('NO_OPERATION');
  });
});

describe('the second provider', () => {
  it('refuses plainly rather than pretending to work', async () => {
    const stub = createStubVideo();
    for (const call of [stub.submit(request), stub.poll('operations/abc')]) {
      const err: unknown = await call.then(
        () => undefined,
        (e: unknown) => e,
      );
      expect(isAdapterError(err) && err.code).toBe('NOT_CONFIGURED');
      expect(isAdapterError(err) && err.category).toBe('terminal');
    }
  });
});

describe('the video registry', () => {
  it('holds the generating provider and the stub, in both modes', () => {
    const fake = createVideoAdapters('fake');
    expect(Object.keys(fake).sort()).toEqual(['second', 'veo-3.1-lite']);
    expect(fake.second.key).toBe('second-video-provider');

    const real = createVideoAdapters('real', { project: 'test-project' });
    expect(Object.keys(real).sort()).toEqual(['second', 'veo-3.1-lite']);
  });

  it('refuses to build real adapters without a project', () => {
    expect(() => createVideoAdapters('real', { project: '' })).toThrow(/GCP project/);
  });

  it('gives the fake the same shape, so a render can run with no provider', async () => {
    const fake = createFakeVideo('veo-3.1-lite');
    const { operationId } = await fake.submit(request);
    expect(await fake.poll(operationId)).toEqual({ status: 'running' });
    const done = await fake.poll(operationId);
    if (done.status !== 'done') throw new Error('expected a clip');
    expect(done.clip.durationSeconds).toBe(8);
  });
});
