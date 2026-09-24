import { createFakeModeration, createTextAdapters } from '@cgp/adapters';
import { createLogger } from '@cgp/config';
import {
  AdapterError,
  type ModerationAdapter,
  type QueuedJobData,
  type TextAdapter,
} from '@cgp/contracts';
import {
  compiledPrompts,
  costTelemetry,
  creditLedger,
  jobs,
  moderationEvents,
  outputs,
  scoped,
  type Database,
} from '@cgp/db';
import {
  addTestProfile,
  createTestDatabase,
  createTestWorkspace,
  insertMeteringRates,
  seedTestCatalog,
} from '@cgp/db/testing';
import { editCompiledPrompt } from '@cgp/orchestration';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { compileGeneration, estimateGeneration, findJob, startGeneration } from './generate';
import { generators } from './generators/definitions';
import { createTextHandlers } from './handlers/text';
import { processJob } from './process';
import { jobOutputs, recentGenerationJobs } from './studio';
import type { Queues } from './queues';

const log = createLogger({ service: 'test', level: 'silent' });

/** Records what would be enqueued, so these tests need no Redis. */
function recordingQueues() {
  const added: Array<{ queue: string; name: string; data: QueuedJobData }> = [];
  const queue = (name: string) => ({
    add: (jobName: string, data: QueuedJobData) => {
      added.push({ queue: name, name: jobName, data });
      return Promise.resolve();
    },
  });
  const queues = {
    inference: queue('inference'),
    render: queue('render'),
    publish: queue('publish'),
  } as unknown as Queues;
  return { queues, added };
}

/** A rewriter slower than any budget that stops when aborted, as real ones do. */
const hanging: TextAdapter = {
  key: 'hanging',
  generate: (request) =>
    new Promise((_, reject) => {
      request.signal?.addEventListener('abort', () =>
        reject(new AdapterError({ code: 'ABORTED', message: 'aborted', category: 'retriable' })),
      );
    }),
  stream: () => {
    throw new Error('not used');
  },
};

let db: Database;

beforeAll(async () => {
  db = await createTestDatabase();
  await insertMeteringRates(db);
  await seedTestCatalog(db);
});

afterAll(async () => {
  await db.close();
});

const intent = { intentText: 'Three reasons to switch to cold brew' };

function deps(queues: Queues, rewriters: TextAdapter[] = []) {
  return {
    db,
    queues,
    log,
    registry: generators,
    compile: { rewriters },
    moderation: createFakeModeration(),
  };
}

async function workspace(credits = 100, videoSeconds = 0) {
  const id = await createTestWorkspace(db, { credits, videoSeconds });
  await addTestProfile(db, id);
  return id;
}

describe('estimateGeneration', () => {
  it('prices with the rates in force and names their version', async () => {
    const result = await estimateGeneration(db, generators, 'thumbnail_set', intent);
    expect(result).toMatchObject({ ok: true, estimate: { credits: 36 }, ratesVersion: 1 });
  });

  it('knows only registered generators', async () => {
    expect(await estimateGeneration(db, generators, 'podcast', intent)).toEqual({
      ok: false,
      reason: 'unknown_generator',
    });
  });

  it('returns input issues rather than throwing', async () => {
    const result = await estimateGeneration(db, generators, 'script', {});
    expect(result).toMatchObject({ ok: false, reason: 'invalid_input' });
  });
});

describe('startGeneration', () => {
  it('compiles, holds, enqueues, and links the prompt to its job', async () => {
    const workspaceId = await workspace(100, 30);
    const { queues, added } = recordingQueues();

    const result = await startGeneration(deps(queues), {
      workspaceId,
      generatorKey: 'video',
      input: { ...intent, sceneCount: 2 },
    });

    if (!result.ok) throw new Error(result.reason);
    expect(result.job).toMatchObject({
      status: 'QUEUED',
      jobClass: 'render',
      held: { credits: 0, videoSeconds: 16 },
    });
    expect(added).toEqual([
      {
        queue: 'render',
        name: 'video',
        data: { jobId: result.job.id, correlationId: result.job.id },
      },
    ]);
    const [job] = await scoped(db, workspaceId).select(jobs);
    expect(job?.input).toMatchObject({ sceneCount: 2, compiledPromptId: result.prompt.id });
    const [prompt] = await scoped(db, workspaceId).select(compiledPrompts);
    expect(prompt?.jobId).toBe(result.job.id);
    expect((await scoped(db, workspaceId).workspace())?.videoSecondsBalance).toBe(14);
  });

  it('dispatches the prompt the user edited, not a fresh compile', async () => {
    const workspaceId = await workspace();
    const { queues } = recordingQueues();
    const compiled = await compileGeneration(
      { db, registry: generators, compile: { rewriters: [] } },
      { workspaceId, generatorKey: 'caption_set', input: intent },
    );
    if (!compiled.ok) throw new Error(compiled.reason);
    const edited = await editCompiledPrompt(db, workspaceId, compiled.prompt.id, 'My words.');
    if (!edited.ok) throw new Error(edited.reason);

    const result = await startGeneration(deps(queues), {
      workspaceId,
      generatorKey: 'caption_set',
      input: intent,
      compiledPromptId: edited.prompt.id,
    });

    if (!result.ok) throw new Error(result.reason);
    expect(result.prompt).toMatchObject({ id: edited.prompt.id, userEdited: true });
    expect(await scoped(db, workspaceId).select(compiledPrompts)).toHaveLength(2);
  });

  it('refuses a prompt compiled for another output type', async () => {
    const workspaceId = await workspace();
    const compiled = await compileGeneration(
      { db, registry: generators, compile: { rewriters: [] } },
      { workspaceId, generatorKey: 'caption_set', input: intent },
    );
    if (!compiled.ok) throw new Error(compiled.reason);
    const result = await startGeneration(deps(recordingQueues().queues), {
      workspaceId,
      generatorKey: 'script',
      input: intent,
      compiledPromptId: compiled.prompt.id,
    });
    expect(result).toEqual({ ok: false, reason: 'prompt_not_found' });
  });

  it('creates no job and no hold for a blocked compiled prompt (invariant 10)', async () => {
    const workspaceId = await workspace();
    const { queues, added } = recordingQueues();

    const result = await startGeneration(deps(queues), {
      workspaceId,
      generatorKey: 'script',
      input: { intentText: 'FAKE_BLOCK:violence a fight scene' },
    });

    expect(result).toEqual({ ok: false, reason: 'blocked', category: 'violence' });
    expect(added).toEqual([]);
    expect(await scoped(db, workspaceId).select(jobs)).toEqual([]);
    expect(await scoped(db, workspaceId).select(creditLedger)).toHaveLength(1); // the grant
    const [prompt] = await scoped(db, workspaceId).select(compiledPrompts);
    expect(await scoped(db, workspaceId).select(moderationEvents)).toMatchObject([
      {
        subjectType: 'compiled_prompt',
        subjectId: prompt?.id,
        verdict: 'blocked',
        category: 'violence',
      },
    ]);
  });

  it('records the verdict on a prompt it lets through', async () => {
    const workspaceId = await workspace();
    const result = await startGeneration(deps(recordingQueues().queues), {
      workspaceId,
      generatorKey: 'script',
      input: intent,
    });
    if (!result.ok) throw new Error(result.reason);
    expect(await scoped(db, workspaceId).select(moderationEvents)).toMatchObject([
      { subjectId: result.prompt.id, verdict: 'allowed', category: null },
    ]);
  });

  it('refuses to dispatch when moderation is unavailable: no job, no hold, no verdict', async () => {
    const workspaceId = await workspace();
    const { queues, added } = recordingQueues();
    const down: ModerationAdapter = {
      key: 'down',
      checkText: () =>
        Promise.reject(
          new AdapterError({ code: 'HTTP_503', message: 'down', category: 'retriable' }),
        ),
      checkImage: () => Promise.reject(new Error('unused')),
    };

    const result = await startGeneration(
      { ...deps(queues), moderation: down },
      { workspaceId, generatorKey: 'script', input: intent },
    );

    expect(result).toEqual({ ok: false, reason: 'moderation_unavailable' });
    expect(added).toEqual([]);
    expect(await scoped(db, workspaceId).select(jobs)).toEqual([]);
    expect(await scoped(db, workspaceId).select(creditLedger)).toHaveLength(1);
    expect(await scoped(db, workspaceId).select(moderationEvents)).toEqual([]);
  });

  it('creates nothing when the balance cannot cover the estimate', async () => {
    const workspaceId = await workspace(5);
    const { queues, added } = recordingQueues();
    const result = await startGeneration(deps(queues), {
      workspaceId,
      generatorKey: 'script',
      input: intent,
    });
    expect(result).toEqual({ ok: false, reason: 'insufficient_credits' });
    expect(added).toEqual([]);
    expect(await scoped(db, workspaceId).select(jobs)).toEqual([]);
  });

  it('asks for a profile before compiling for a workspace without one', async () => {
    const workspaceId = await createTestWorkspace(db, { credits: 100 });
    const result = await startGeneration(deps(recordingQueues().queues), {
      workspaceId,
      generatorKey: 'script',
      input: intent,
    });
    expect(result).toEqual({ ok: false, reason: 'profile_required' });
  });
});

describe('text generation end to end', () => {
  const adapters = createTextAdapters('fake');
  const deltas: string[] = [];
  // Built on first use: db only exists once beforeAll has run.
  const textHandlers = () =>
    createTextHandlers({
      db,
      registry: generators,
      adapters,
      moderation: createFakeModeration(),
      publishDelta: (_jobId, text) => {
        deltas.push(text);
        return Promise.resolve();
      },
      costInr: () => 0,
      providerLabel: 'fake',
    });
  let handlers: ReturnType<typeof createTextHandlers>;
  beforeAll(() => {
    handlers = textHandlers();
  });

  it('has a handler for each text generator only', () => {
    expect(Object.keys(handlers).sort()).toEqual(['caption_set', 'hook_title_set', 'script']);
  });

  it('forced 1500ms breach: falls back, generation succeeds, compile uses no credit', async () => {
    const workspaceId = await workspace(10);
    const { queues } = recordingQueues();

    const started = await startGeneration(deps(queues, [hanging]), {
      workspaceId,
      generatorKey: 'script',
      input: intent,
    });
    if (!started.ok) throw new Error(started.reason);
    expect(started.prompt.fallbackUsed).toBe(true);

    const result = await processJob(
      { db, handlers, log },
      { jobId: started.job.id, correlationId: started.job.id },
    );
    expect(result).toBe('settled');

    const job = await findJob(db, workspaceId, started.job.id);
    expect(job).toMatchObject({ status: 'COMPLETE', settled: { credits: 6, videoSeconds: 0 } });

    // Only the grant, the job's hold and its settle (zero: the actual equals the hold). Compile
    // wrote nothing.
    const ledger = await scoped(db, workspaceId).select(creditLedger);
    expect(ledger.map((e) => [e.reason, e.delta])).toEqual([
      ['grant', 10],
      ['hold', -6],
      ['settle', 0],
    ]);
    expect((await scoped(db, workspaceId).workspace())?.creditBalance).toBe(4);

    const [output] = await scoped(db, workspaceId).select(outputs);
    expect(output).toMatchObject({
      jobId: started.job.id,
      kind: 'script',
      compiledPromptId: started.prompt.id,
    });
    expect((output?.metadata as { text: string }).text).toContain('[fake gemini-flash-lite]');
    expect(deltas.join('')).toBe((output?.metadata as { text: string }).text);

    const [telemetry] = await scoped(db, workspaceId).select(costTelemetry);
    expect(telemetry).toMatchObject({ actionClass: 'script', provider: 'fake:gemini-flash-lite' });
  });

  it('stores JSON output for JSON generators and refunds when it is not JSON', async () => {
    const workspaceId = await workspace(10);
    const { queues } = recordingQueues();
    const ok = await startGeneration(deps(queues), {
      workspaceId,
      generatorKey: 'caption_set',
      input: intent,
    });
    if (!ok.ok) throw new Error(ok.reason);
    expect(await processJob({ db, handlers, log }, { jobId: ok.job.id, correlationId: 'c' })).toBe(
      'settled',
    );

    const failing = createTextHandlers({
      db,
      registry: generators,
      adapters: {
        'gemini-flash-lite': {
          key: 'broken',
          generate: () => Promise.reject(new Error('unused')),
          async *stream() {
            await Promise.resolve();
            yield {
              type: 'done' as const,
              result: {
                text: 'not json',
                finishReason: 'stop' as const,
                usage: { inputTokens: 1, outputTokens: 1 },
              },
            };
          },
        },
      },
      moderation: createFakeModeration(),
      publishDelta: () => Promise.resolve(),
      costInr: () => 0,
      providerLabel: 'fake',
    });
    const bad = await startGeneration(deps(queues), {
      workspaceId,
      generatorKey: 'caption_set',
      input: intent,
    });
    if (!bad.ok) throw new Error(bad.reason);
    expect(
      await processJob({ db, handlers: failing, log }, { jobId: bad.job.id, correlationId: 'c' }),
    ).toBe('refunded');
    expect((await scoped(db, workspaceId).workspace())?.creditBalance).toBe(9);
  });

  it('settles a redelivered job without calling the provider again', async () => {
    const workspaceId = await workspace(10);
    const started = await startGeneration(deps(recordingQueues().queues), {
      workspaceId,
      generatorKey: 'hook_title_set',
      input: intent,
    });
    if (!started.ok) throw new Error(started.reason);
    const job = (await scoped(db, workspaceId).select(jobs))[0];
    if (!job) throw new Error('no job');

    const handler = handlers.hook_title_set;
    if (!handler) throw new Error('no handler');
    await handler(job, log);
    const again = await handler(job, log);
    expect(again.telemetry.realisedCostInr).toBe(0);
    expect(await scoped(db, workspaceId).select(outputs)).toHaveLength(1);
  });
});

describe('findJob', () => {
  it('never shows a job from another workspace', async () => {
    const owner = await workspace(10);
    const other = await createTestWorkspace(db, { credits: 10 });
    const result = await startGeneration(deps(recordingQueues().queues), {
      workspaceId: owner,
      generatorKey: 'caption_set',
      input: intent,
    });
    if (!result.ok) throw new Error('expected a job');

    expect(await findJob(db, owner, result.job.id)).toBeDefined();
    expect(await findJob(db, other, result.job.id)).toBeUndefined();
    expect(await findJob(db, owner, 'not-a-uuid')).toBeUndefined();
  });
});

describe('studio helpers', () => {
  it('lists recent generation jobs with their intent, and a finished job’s output', async () => {
    const workspaceId = await workspace(20);
    const { queues } = recordingQueues();
    const started = await startGeneration(deps(queues), {
      workspaceId,
      generatorKey: 'caption_set',
      input: intent,
    });
    if (!started.ok) throw new Error(started.reason);

    const [recent] = await recentGenerationJobs(db, workspaceId);
    expect(recent).toMatchObject({
      id: started.job.id,
      generatorKey: 'caption_set',
      intentText: intent.intentText,
      status: 'QUEUED',
    });
    expect(await jobOutputs(db, workspaceId, started.job.id)).toEqual([]);

    const handlers = createTextHandlers({
      db,
      registry: generators,
      adapters: createTextAdapters('fake'),
      moderation: createFakeModeration(),
      publishDelta: () => Promise.resolve(),
      costInr: () => 0,
      providerLabel: 'fake',
    });
    await processJob({ db, handlers, log }, { jobId: started.job.id, correlationId: 'c' });

    const [output] = await jobOutputs(db, workspaceId, started.job.id);
    expect(output).toMatchObject({ kind: 'caption', compiledPromptId: started.prompt.id });
    expect(JSON.parse(output?.text ?? '')).toMatchObject({ fake: true });

    const other = await createTestWorkspace(db);
    expect(await jobOutputs(db, other, started.job.id)).toEqual([]);
    expect(await recentGenerationJobs(db, other)).toEqual([]);
  });
});
