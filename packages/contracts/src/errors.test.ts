import { describe, expect, it } from 'vitest';
import { AdapterError, isAdapterError } from './errors';

describe('AdapterError', () => {
  it('carries only the normalised fields', () => {
    const err = new AdapterError({ code: 'RATE_LIMITED', message: 'slow down', category: 'quota' });
    expect(err).toMatchObject({ name: 'AdapterError', code: 'RATE_LIMITED', category: 'quota' });
    expect('retryAfterMs' in err).toBe(false);
    expect(err.cause).toBeUndefined();
  });
});

describe('isAdapterError', () => {
  it('accepts an AdapterError, including one from a duplicated copy of the module', () => {
    expect(
      isAdapterError(new AdapterError({ code: 'X', message: 'x', category: 'terminal' })),
    ).toBe(true);
    const lookalike = Object.assign(new Error('x'), {
      name: 'AdapterError',
      code: 'X',
      category: 'reauth',
    });
    expect(isAdapterError(lookalike)).toBe(true);
  });

  it('rejects plain errors and unknown categories', () => {
    expect(isAdapterError(new Error('x'))).toBe(false);
    expect(isAdapterError({ name: 'AdapterError', code: 'X', category: 'quota' })).toBe(false);
    const badCategory = Object.assign(new Error('x'), {
      name: 'AdapterError',
      code: 'X',
      category: 'maybe',
    });
    expect(isAdapterError(badCategory)).toBe(false);
  });
});
