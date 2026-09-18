import { isAdapterError, type TextAdapter, type TextStreamEvent } from '@cgp/contracts';
import { describe, expect, it } from 'vitest';
import { TEXT_MODEL_KEYS } from '../models';
import { createTextAdapters } from '../registry';

// One contract for every text adapter. Fakes always run; the real providers run only with
// CGP_LIVE_PROVIDERS=1, because each call spends (a very little) trial credit.
const live = process.env.CGP_LIVE_PROVIDERS === '1';
const project = process.env.GOOGLE_CLOUD_PROJECT ?? '';

const suites: [string, () => TextAdapter[]][] = [
  ['fake', () => Object.values(createTextAdapters('fake'))],
];
if (live) {
  suites.push(['real', () => Object.values(createTextAdapters('real', { project }))]);
}

const request = {
  system: 'Answer in one short sentence.',
  prompt: 'Name one colour of the Indian flag.',
  maxOutputTokens: 256,
};

async function collect(events: AsyncIterable<TextStreamEvent>) {
  const deltas: string[] = [];
  const dones: TextStreamEvent[] = [];
  for await (const event of events) {
    if (event.type === 'delta') deltas.push(event.text);
    else dones.push(event);
  }
  return { deltas, dones };
}

describe.each(suites)('text adapter contract (%s)', (_mode, adapters) => {
  const all = adapters();

  it('has one adapter per configured model', () => {
    expect(all.map((a) => a.key).sort()).toEqual([...TEXT_MODEL_KEYS].sort());
  });

  it.each(all.map((a) => [a.key, a] as const))(
    '%s generates text with usage',
    async (_key, adapter) => {
      const result = await adapter.generate(request);
      expect(result.text.trim()).not.toBe('');
      expect(result.finishReason).toBe('stop');
      expect(result.usage.inputTokens).toBeGreaterThan(0);
      expect(result.usage.outputTokens).toBeGreaterThan(0);
    },
  );

  it.each(all.map((a) => [a.key, a] as const))(
    '%s streams deltas then exactly one done',
    async (_key, adapter) => {
      const { deltas, dones } = await collect(adapter.stream(request));
      expect(deltas.length).toBeGreaterThan(0);
      expect(dones).toHaveLength(1);
      const done = dones[0];
      if (done?.type !== 'done') throw new Error('expected a done event');
      expect(done.result.text).toBe(deltas.join(''));
      expect(done.result.usage.outputTokens).toBeGreaterThan(0);
    },
  );

  it.each(all.map((a) => [a.key, a] as const))(
    '%s turns an abort into ABORTED',
    async (_key, adapter) => {
      const err: unknown = await adapter.generate({ ...request, signal: AbortSignal.abort() }).then(
        () => undefined,
        (e: unknown) => e,
      );
      expect(isAdapterError(err) && err.code).toBe('ABORTED');
      expect(isAdapterError(err) && err.category).toBe('retriable');
    },
  );
});

describe('fake text', () => {
  const { 'gemini-flash-lite': fake } = createTextAdapters('fake');

  it('fails with the category a prompt asks for', async () => {
    await expect(fake.generate({ ...request, prompt: 'FAKE_FAIL:quota' })).rejects.toMatchObject({
      category: 'quota',
    });
  });

  it('returns parseable JSON when asked', async () => {
    const result = await fake.generate({ ...request, format: 'json' });
    expect(JSON.parse(result.text)).toMatchObject({ fake: true });
  });

  it('refuses to build real adapters without a project', () => {
    expect(() => createTextAdapters('real', { project: '' })).toThrow(/GCP project/);
  });
});
