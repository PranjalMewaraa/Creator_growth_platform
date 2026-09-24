import type {
  CompilerProfileConfig,
  ModerationAdapter,
  OutputType,
  TextAdapter,
  TextResult,
  TokenUsage,
} from '@cgp/contracts';
import { catalog, compilerProfiles, outputs, scoped, type Database } from '@cgp/db';
import { findCompiledPrompt } from '@cgp/orchestration';
import type { GeneratorRegistry } from '../generators/registry';
import { postCheckOutput } from '../moderation';
import { JobBlocked, type JobHandler } from '../process';

const TEXT_OUTPUTS: ReadonlySet<OutputType> = new Set(['script', 'hook', 'caption']);

export interface TextHandlerDeps {
  db: Database;
  registry: GeneratorRegistry;
  /** By model key, as generators name them in `providerAdapter`. */
  adapters: Readonly<Record<string, TextAdapter>>;
  /** Checks what came back before any of it is stored. */
  moderation: ModerationAdapter;
  /** Relays a streamed delta (D9). Best effort: a failure never fails the job. */
  publishDelta: (jobId: string, text: string) => Promise<void>;
  /** Realised cost for telemetry; zero for fakes. */
  costInr: (adapterKey: string, usage: TokenUsage) => number;
  /** Recorded as the telemetry provider, such as `vertex` or `fake`. */
  providerLabel: string;
}

interface TextJobInput {
  compiledPromptId?: unknown;
}

/**
 * Handlers for every text generator in the registry. Each runs the compiled prompt exactly as
 * persisted: the handler adds no prompt text (invariant 4), and the system instruction and
 * token ceiling come from the same compiler profile version the prompt was compiled with.
 */
export function createTextHandlers(deps: TextHandlerDeps): Record<string, JobHandler> {
  const handlers: Record<string, JobHandler> = {};
  for (const generator of deps.registry.list()) {
    if (!TEXT_OUTPUTS.has(generator.outputType)) continue;

    handlers[generator.key] = async (job, log) => {
      const ws = scoped(deps.db, job.workspaceId);
      const settled = {
        actual: { credits: job.creditsHeld, videoSeconds: 0 },
      };

      // A redelivered job whose output already exists is not generated, or paid for, twice.
      const [existing] = await ws.select(outputs, { where: (t, op) => op.eq(t.jobId, job.id) });
      if (existing) {
        log.info({ jobId: job.id }, 'output already stored, settling without a provider call');
        return {
          ...settled,
          telemetry: {
            actionClass: generator.key,
            provider: deps.providerLabel,
            realisedCostInr: 0,
          },
        };
      }

      const { compiledPromptId } = job.input as TextJobInput;
      if (typeof compiledPromptId !== 'string') throw new Error('Job has no compiled prompt');
      const prompt = await findCompiledPrompt(deps.db, job.workspaceId, compiledPromptId);
      if (!prompt) throw new Error('Compiled prompt not found');

      const [profile] = await catalog(deps.db).select(compilerProfiles, {
        where: (t, op) =>
          op.and(
            op.eq(t.key, prompt.compilerProfileKey),
            op.eq(t.version, prompt.compilerProfileVersion),
          ),
        limit: 1,
      });
      const generation = (profile?.config as CompilerProfileConfig | undefined)?.generation;
      if (!generation) throw new Error(`${prompt.compilerProfileKey} has no generation settings`);

      const adapter = deps.adapters[generator.providerAdapter];
      if (!adapter) throw new Error(`No text adapter ${generator.providerAdapter}`);

      let result: TextResult | undefined;
      for await (const event of adapter.stream({
        prompt: prompt.text,
        system: generation.system,
        maxOutputTokens: generation.maxOutputTokens,
        temperature: generation.temperature,
        format: generation.format,
      })) {
        if (event.type === 'delta') {
          await deps.publishDelta(job.id, event.text).catch((err: unknown) => {
            log.warn({ err, jobId: job.id }, 'delta relay failed');
          });
        } else {
          result = event.result;
        }
      }
      if (!result) throw new Error('Stream ended without a result');
      if (result.finishReason === 'safety') throw new JobBlocked('other');
      if (generation.format === 'json') {
        try {
          JSON.parse(result.text);
        } catch {
          throw new Error(`${adapter.key} returned text that is not JSON`);
        }
      }

      // Checked before it is stored, so a blocked generation is never readable (WP16).
      const blocked = await postCheckOutput(
        { db: deps.db, moderation: deps.moderation, log },
        job,
        { text: result.text },
      );
      if (blocked) throw new JobBlocked(blocked);

      // Text is small, so it lives on the output row until object storage exists (WP6).
      await ws.insert(outputs, {
        jobId: job.id,
        kind: generator.outputType,
        storageKey: `inline:${job.id}`,
        metadata: {
          text: result.text,
          finishReason: result.finishReason,
          usage: result.usage,
          adapter: adapter.key,
        },
        compiledPromptId: prompt.id,
        templateId: prompt.templateId,
        brandKitVersion: prompt.brandKitVersion,
      });

      return {
        ...settled,
        telemetry: {
          actionClass: generator.key,
          provider: `${deps.providerLabel}:${adapter.key}`,
          realisedCostInr: deps.costInr(adapter.key, result.usage),
          tokensIn: result.usage.inputTokens,
          tokensOut: result.usage.outputTokens,
        },
      };
    };
  }
  return handlers;
}
