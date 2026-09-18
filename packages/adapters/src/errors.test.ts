import { AdapterError } from '@cgp/contracts';
import { describe, expect, it } from 'vitest';
import { categoryForStatus, normalizeError } from './errors';

describe('categoryForStatus', () => {
  it.each([
    [undefined, 'retriable'],
    [408, 'retriable'],
    [429, 'quota'],
    [500, 'retriable'],
    [503, 'retriable'],
    [400, 'terminal'],
    [401, 'terminal'],
    [403, 'terminal'],
    [404, 'terminal'],
  ] as const)('maps %s to %s', (status, category) => {
    expect(categoryForStatus(status)).toBe(category);
  });
});

describe('normalizeError', () => {
  it('passes an AdapterError through untouched', () => {
    const err = new AdapterError({ code: 'X', message: 'x', category: 'quota' });
    expect(normalizeError('gemini', err)).toBe(err);
  });

  it('never exposes the provider message', () => {
    const raw = Object.assign(new Error('project creatorpltfrm secret detail'), { status: 400 });
    const err = normalizeError('claude', raw);
    expect(err).toMatchObject({ code: 'HTTP_400', category: 'terminal' });
    expect(err.message).toBe('claude request failed with HTTP 400');
    expect(err.message).not.toContain('secret');
  });

  it('reads retry-after on a 429', () => {
    const raw = Object.assign(new Error('slow down'), {
      status: 429,
      headers: new Headers({ 'retry-after': '7' }),
    });
    expect(normalizeError('gpt-oss', raw)).toMatchObject({
      code: 'HTTP_429',
      category: 'quota',
      retryAfterMs: 7000,
    });
  });

  it('treats a failure with no status as a retriable network error', () => {
    expect(normalizeError('gemini', new TypeError('fetch failed'))).toMatchObject({
      code: 'NETWORK',
      category: 'retriable',
    });
  });

  it('treats any failure on an aborted request as ABORTED, whatever the SDK calls it', () => {
    expect(
      normalizeError('claude', new Error('Request was aborted.'), undefined, AbortSignal.abort()),
    ).toMatchObject({ code: 'ABORTED', category: 'retriable' });
  });

  it('treats an abort as retriable', () => {
    const abort = new DOMException('The operation was aborted', 'AbortError');
    expect(normalizeError('gemini', abort)).toMatchObject({
      code: 'ABORTED',
      category: 'retriable',
    });
  });
});
