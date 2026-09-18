import type { JobStatus, JobView } from '@cgp/contracts';
import { describe, expect, it } from 'vitest';
import { jobEventStream, type JobStreamSource } from './job-stream';

function view(status: JobStatus, at: number): JobView {
  return {
    id: 'job',
    generatorKey: 'script',
    jobClass: 'inference',
    status,
    held: { credits: 6, videoSeconds: 0 },
    settled: status === 'COMPLETE' ? { credits: 6, videoSeconds: 0 } : null,
    error: null,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(at).toISOString(),
  };
}

async function readAll(stream: ReadableStream<Uint8Array>) {
  const text = await new Response(stream).text();
  return text
    .split('\n\n')
    .filter((block) => block.startsWith('event:'))
    .map((block) => JSON.parse(block.split('\ndata: ')[1] ?? '') as unknown);
}

/** Plays back a scripted series of reads, emitting deltas between them. */
function scripted(steps: Array<{ job: JobView | undefined; deltas?: string[] }>) {
  let unsubscribed = false;
  let onDelta: ((text: string) => void) | undefined;
  let i = 0;
  const source: JobStreamSource = {
    read: () => {
      const step = steps[Math.min(i++, steps.length - 1)];
      for (const delta of step?.deltas ?? []) onDelta?.(delta);
      return Promise.resolve(step?.job);
    },
    subscribe: (fn) => {
      onDelta = fn;
      return Promise.resolve(() => {
        unsubscribed = true;
        return Promise.resolve();
      });
    },
  };
  return { source, unsubscribed: () => unsubscribed };
}

describe('jobEventStream', () => {
  it('sends status changes and deltas, then ends at a terminal status', async () => {
    const { source, unsubscribed } = scripted([
      { job: view('QUEUED', 1) },
      { job: view('RUNNING', 2), deltas: ['Hello', ' world'] },
      { job: view('RUNNING', 2) },
      { job: view('COMPLETE', 3) },
    ]);

    const events = await readAll(jobEventStream(source, { pollMs: 1 }));

    expect(events).toEqual([
      { type: 'status', job: view('QUEUED', 1) },
      { type: 'delta', text: 'Hello' },
      { type: 'delta', text: ' world' },
      { type: 'status', job: view('RUNNING', 2) },
      { type: 'status', job: view('COMPLETE', 3) },
    ]);
    expect(unsubscribed()).toBe(true);
  });

  it('closes after the time limit so the client reconnects', async () => {
    const { source, unsubscribed } = scripted([{ job: view('RUNNING', 1) }]);
    const events = await readAll(jobEventStream(source, { pollMs: 1, maxMs: 20 }));
    expect(events).toEqual([{ type: 'status', job: view('RUNNING', 1) }]);
    expect(unsubscribed()).toBe(true);
  });

  it('ends quietly when the job disappears', async () => {
    const { source } = scripted([{ job: undefined }]);
    expect(await readAll(jobEventStream(source, { pollMs: 1 }))).toEqual([]);
  });
});
