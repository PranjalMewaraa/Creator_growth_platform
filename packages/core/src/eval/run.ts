import type { Logger } from '@cgp/config';
import type { CompilerProfileConfig, TextAdapter } from '@cgp/contracts';
import { catalog, compilerProfiles, templates, type Database } from '@cgp/db';
import { compile } from '@cgp/orchestration';
import { EVAL_INTENTS, type EvalIntent } from './intents';

/**
 * The evaluation harness (WP20, plan section 11). Each intent is generated twice through the
 * same model with the same ceiling: once from the compiled prompt, once from the intent exactly
 * as typed. The raw arm is the control the demo claim rests on, and it is the only place raw
 * mode exists: it is never offered to a creator (plan section 16).
 *
 * Nothing here charges credits or writes an output row. An eval run is research, not the
 * creator's work, so it calls the adapter directly and writes its results to a file.
 */

export interface EvalArmResult {
  text: string;
  prompt: string;
  elapsedMs: number;
  outputTokens: number;
}

export interface EvalResult {
  intent: EvalIntent;
  compiled: EvalArmResult;
  raw: EvalArmResult;
  /** The compiled prompt's id, so a result can be traced back to its lineage (invariant 8). */
  compiledPromptId: string;
  fallbackUsed: boolean;
}

export interface EvalFailure {
  intentId: string;
  reason: string;
}

export interface EvalRun {
  results: EvalResult[];
  /** Intents that could not be generated. A short run is better than a lost one. */
  failures: EvalFailure[];
}

export interface EvalDeps {
  db: Database;
  /** The model both arms run on. One model, one ceiling, one variable: the prompt. */
  adapter: TextAdapter;
  /** The rewrite providers for the compile stage, in order. */
  rewriters: TextAdapter[];
  log: Logger;
}

async function generationSettings(
  db: Database,
  key: string,
  version: number,
): Promise<NonNullable<CompilerProfileConfig['generation']>> {
  const [profile] = await catalog(db).select(compilerProfiles, {
    where: (t, op) => op.and(op.eq(t.key, key), op.eq(t.version, version)),
    limit: 1,
  });
  const generation = (profile?.config as CompilerProfileConfig | undefined)?.generation;
  if (!generation) throw new Error(`${key} has no generation settings`);
  return generation;
}

async function run(
  adapter: TextAdapter,
  prompt: string,
  generation: NonNullable<CompilerProfileConfig['generation']>,
  system?: string,
): Promise<EvalArmResult> {
  const started = Date.now();
  const result = await adapter.generate({
    prompt,
    ...(system === undefined ? {} : { system }),
    maxOutputTokens: generation.maxOutputTokens,
    temperature: generation.temperature,
    ...(generation.format ? { format: generation.format } : {}),
  });
  return {
    text: result.text,
    prompt,
    elapsedMs: Date.now() - started,
    outputTokens: result.usage.outputTokens,
  };
}

/**
 * Runs the set, or the intents named. The raw arm gets no system instruction and no
 * requirements: the creator's words, straight to the model, which is the honest control.
 */
export async function runEvalSet(
  deps: EvalDeps,
  workspaceId: string,
  options: { only?: string[] } = {},
): Promise<EvalRun> {
  const chosen = options.only
    ? EVAL_INTENTS.filter((intent) => options.only?.includes(intent.id))
    : EVAL_INTENTS;
  const results: EvalResult[] = [];
  const failures: EvalFailure[] = [];

  for (const intent of chosen) {
    try {
      const templateId = intent.templateSlug
        ? (
            await catalog(deps.db).select(templates, {
              where: (t, op) => op.eq(t.slug, intent.templateSlug ?? ''),
              limit: 1,
            })
          )[0]?.id
        : undefined;

      const compiled = await compile(
        { db: deps.db, rewriters: deps.rewriters, log: deps.log },
        {
          workspaceId,
          outputType: intent.outputType,
          intentText: intent.text,
          targetPlatform: intent.targetPlatform,
          ...(templateId ? { templateId } : {}),
          params: {},
        },
      );
      if (!compiled.ok) throw new Error(`compile refused (${compiled.reason})`);

      // The same settings the real generator would use, from the profile version it compiled at.
      const generation = await generationSettings(
        deps.db,
        `${intent.outputType}.en`,
        compiled.prompt.lineage.compilerProfileVersion,
      );

      const compiledArm = await withQuotaRetry(deps, () =>
        run(deps.adapter, compiled.prompt.text, generation, generation.system),
      );
      // The control: exactly what was typed, no system instruction, same model and ceiling.
      const rawArm = await withQuotaRetry(deps, () => run(deps.adapter, intent.text, generation));

      results.push({
        intent,
        compiled: compiledArm,
        raw: rawArm,
        compiledPromptId: compiled.prompt.id,
        fallbackUsed: compiled.prompt.fallbackUsed,
      });
      deps.log.info(
        { intent: intent.id, compiledMs: compiledArm.elapsedMs, rawMs: rawArm.elapsedMs },
        'eval intent done',
      );
    } catch (err) {
      // One intent that will not generate does not end the run: the rest is still a set.
      const reason = err instanceof Error ? err.message : String(err);
      failures.push({ intentId: intent.id, reason });
      deps.log.warn({ err, intent: intent.id }, 'eval intent failed');
    }
  }
  return { results, failures };
}

/** Text models meter by the minute too, and forty calls in a row find the limit. */
const QUOTA_WAIT_MS = 45_000;

async function withQuotaRetry<T>(deps: EvalDeps, work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!/429|quota/i.test(message)) throw err;
    deps.log.info({ waitMs: QUOTA_WAIT_MS }, 'provider quota reached, waiting to try again');
    await new Promise((resolve) => setTimeout(resolve, QUOTA_WAIT_MS));
    return work();
  }
}
