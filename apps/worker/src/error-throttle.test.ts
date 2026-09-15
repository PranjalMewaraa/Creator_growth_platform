import type { Logger } from '@cgp/config';
import { describe, expect, it, vi } from 'vitest';
import { createErrorThrottle } from './error-throttle';

function refused() {
  return Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
}

describe('createErrorThrottle', () => {
  it('logs the first error, suppresses repeats in the window, then reports the count', () => {
    const error = vi.fn();
    let clock = 0;
    const report = createErrorThrottle({ error } as unknown as Logger, {
      windowMs: 10_000,
      now: () => clock,
    });

    report('redis', refused());
    clock = 500;
    report('redis', refused());
    report('redis', refused());
    expect(error).toHaveBeenCalledTimes(1);

    clock = 10_500;
    report('redis', refused());
    expect(error).toHaveBeenCalledTimes(2);
    expect(error.mock.calls[1]?.[0]).toMatchObject({ source: 'redis', suppressed: 2 });
  });

  it('keeps different sources and error kinds separate', () => {
    const error = vi.fn();
    const report = createErrorThrottle({ error } as unknown as Logger, { now: () => 0 });

    report('inference', refused());
    report('render', refused());
    report('inference', new Error('something else'));
    expect(error).toHaveBeenCalledTimes(3);
  });
});
