import { describe, expect, it } from 'vitest';
import { createPacer } from './pace';

/** A clock that only moves when something waits on it, so the tests take no real time. */
function fakeClock() {
  let now = 0;
  return {
    now: () => now,
    sleep: (ms: number) => {
      now += ms;
      return Promise.resolve();
    },
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe('the image pacer (WP40)', () => {
  it('lets the allowance through at once and holds the next one back', async () => {
    const clock = fakeClock();
    const pacer = createPacer({ perMinute: 2, now: clock.now, sleep: clock.sleep });
    const at: number[] = [];
    const call = () => {
      at.push(clock.now());
      return Promise.resolve('ok');
    };

    await pacer.run(call);
    await pacer.run(call);
    await pacer.run(call);

    // Two straight away; the third once the first has aged out of the window.
    expect(at[0]).toBe(0);
    expect(at[1]).toBe(0);
    expect(at[2]).toBeGreaterThanOrEqual(60_000);
  });

  it('counts a window that has moved on, rather than a total', async () => {
    const clock = fakeClock();
    const pacer = createPacer({ perMinute: 2, now: clock.now, sleep: clock.sleep });
    const at: number[] = [];
    const call = () => {
      at.push(clock.now());
      return Promise.resolve('ok');
    };

    await pacer.run(call);
    await pacer.run(call);
    clock.advance(61_000);
    await pacer.run(call);

    // A minute later the window is empty again, so nothing waits.
    expect(at[2]).toBe(61_000);
  });

  it('waits out a refusal from the provider and tries again', async () => {
    const clock = fakeClock();
    const pacer = createPacer({
      perMinute: 2,
      now: clock.now,
      sleep: clock.sleep,
      isQuotaError: (err) => (err as Error).message.includes('429'),
    });
    let attempts = 0;
    const flaky = () => {
      attempts += 1;
      // Another process spent the window: the first call is refused, the second is not.
      return attempts === 1
        ? Promise.reject(new Error('gemini request failed with HTTP 429'))
        : Promise.resolve('drawn');
    };

    expect(await pacer.run(flaky)).toBe('drawn');
    expect(attempts).toBe(2);
    expect(clock.now()).toBeGreaterThan(0);
  });

  it('gives up on a refusal that keeps coming, rather than waiting forever', async () => {
    const clock = fakeClock();
    const pacer = createPacer({
      perMinute: 2,
      retries: 2,
      now: clock.now,
      sleep: clock.sleep,
      isQuotaError: () => true,
    });
    let attempts = 0;

    await expect(
      pacer.run(() => {
        attempts += 1;
        return Promise.reject(new Error('HTTP 429'));
      }),
    ).rejects.toThrow('429');
    expect(attempts).toBe(3);
  });

  it('passes anything that is not the quota straight back', async () => {
    const clock = fakeClock();
    const pacer = createPacer({
      perMinute: 2,
      now: clock.now,
      sleep: clock.sleep,
      isQuotaError: () => false,
    });
    let attempts = 0;

    await expect(
      pacer.run(() => {
        attempts += 1;
        return Promise.reject(new Error('blocked by the safety filter'));
      }),
    ).rejects.toThrow('safety');
    // A refusal that waiting cannot fix is not waited on.
    expect(attempts).toBe(1);
  });

  it('keeps one queue, so two callers cannot take the same slot', async () => {
    const clock = fakeClock();
    const pacer = createPacer({ perMinute: 1, now: clock.now, sleep: clock.sleep });
    const at: number[] = [];
    const call = () => {
      at.push(clock.now());
      return Promise.resolve('ok');
    };

    await Promise.all([pacer.run(call), pacer.run(call)]);

    expect(at[0]).toBe(0);
    expect(at[1]).toBeGreaterThanOrEqual(60_000);
  });
});
