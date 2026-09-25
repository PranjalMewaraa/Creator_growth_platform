import { AdapterError, type VideoAdapter } from '@cgp/contracts';

/**
 * The second video provider (FR-VD-17), wired but not signed up for. It exists so the seam is
 * real: the registry holds two providers, a caller can name either, and swapping in a live one
 * is this file rather than a change to the engine.
 *
 * It refuses rather than pretending. A stub that quietly returned nothing would look like a
 * provider having a bad day, and the demo would be built on a fiction.
 */
export function createStubVideo(key = 'second-video-provider'): VideoAdapter {
  const refusal = () =>
    Promise.reject(
      new AdapterError({
        code: 'NOT_CONFIGURED',
        message: `${key} is wired but has no account yet`,
        category: 'terminal',
      }),
    );

  return { key, submit: refusal, poll: refusal };
}
