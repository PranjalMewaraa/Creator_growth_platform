import { AdapterError, type TextAdapter } from '@cgp/contracts';
import { describe, expect, it } from 'vitest';
import type { Providers } from './registry';
import { warmProviders } from './warm';

function stub(key: string, calls: string[], fail = false): TextAdapter {
  return {
    key,
    generate: (request) => {
      calls.push(`${key}:${request.maxOutputTokens}`);
      return fail
        ? Promise.reject(new AdapterError({ code: 'X', message: 'no', category: 'retriable' }))
        : Promise.resolve({
            text: '',
            finishReason: 'length' as const,
            usage: { inputTokens: 1, outputTokens: 1 },
          });
    },
    stream: () => {
      throw new Error('not used');
    },
  };
}

function providers(mode: 'fake' | 'real', rewriters: TextAdapter[]): Providers {
  return { mode, rewriters } as unknown as Providers;
}

describe('warmProviders', () => {
  it('spends one tiny call on each rewrite provider', async () => {
    const calls: string[] = [];
    await warmProviders(providers('real', [stub('a', calls), stub('b', calls)]));
    expect(calls).toEqual(['a:1', 'b:1']);
  });

  it('warms a provider listed twice only once', async () => {
    const calls: string[] = [];
    const shared = stub('a', calls);
    await warmProviders(providers('real', [shared, shared]));
    expect(calls).toEqual(['a:1']);
  });

  it('warms nothing when the providers are fakes', async () => {
    const calls: string[] = [];
    await warmProviders(providers('fake', [stub('a', calls)]));
    expect(calls).toEqual([]);
  });

  it('never rejects when a provider is down', async () => {
    const calls: string[] = [];
    await expect(
      warmProviders(providers('real', [stub('a', calls, true)])),
    ).resolves.toBeUndefined();
    expect(calls).toEqual(['a:1']);
  });
});
