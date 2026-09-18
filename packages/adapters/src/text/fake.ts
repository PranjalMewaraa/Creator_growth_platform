import {
  AdapterError,
  FAILURE_CATEGORIES,
  type TextAdapter,
  type TextRequest,
  type TextResult,
  type TextStreamEvent,
} from '@cgp/contracts';

/**
 * Deterministic text with no provider and no cost (PROVIDERS=fake). Tests and UI work run on
 * this by default. A prompt containing `FAKE_FAIL:<category>` fails with that category, so
 * error paths can be exercised end to end.
 */
export function createFakeText(key: string): TextAdapter {
  function respond(request: TextRequest): TextResult {
    if (request.signal?.aborted) {
      throw new AdapterError({
        code: 'ABORTED',
        message: `${key} request was cancelled or timed out`,
        category: 'retriable',
      });
    }
    const failure = /FAKE_FAIL:(\w+)/.exec(request.prompt)?.[1];
    if (failure) {
      const category = FAILURE_CATEGORIES.find((c) => c === failure) ?? 'terminal';
      throw new AdapterError({ code: 'FAKE_FAILURE', message: `${key} fake failure`, category });
    }
    const words = request.prompt.trim().split(/\s+/).slice(0, 12).join(' ');
    const text =
      request.format === 'json'
        ? JSON.stringify({ fake: true, echo: words })
        : `[fake ${key}] ${words}`;
    return {
      text,
      finishReason: 'stop',
      usage: {
        inputTokens: Math.ceil(((request.system?.length ?? 0) + request.prompt.length) / 4),
        outputTokens: Math.ceil(text.length / 4),
      },
    };
  }

  return {
    key,
    generate(request) {
      try {
        return Promise.resolve(respond(request));
      } catch (err) {
        return Promise.reject(err instanceof Error ? err : new Error(String(err)));
      }
    },
    async *stream(request): AsyncIterable<TextStreamEvent> {
      const result = respond(request);
      // Word by word, like a real stream, so consumers handle many small deltas.
      const pieces = result.text.split(/(?<= )/);
      for (const piece of pieces) {
        await Promise.resolve();
        yield { type: 'delta', text: piece };
      }
      yield { type: 'done', result };
    },
  };
}
