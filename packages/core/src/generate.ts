import type {
  CompiledPromptView,
  CreditEstimate,
  JobView,
  ModerationCategory,
  ModerationAdapter,
  TargetPlatform,
} from '@cgp/contracts';
import { compile, findCompiledPrompt, toView, type CompileDeps } from '@cgp/orchestration';
import { currentMeteringRates, jobs, scoped, type Database, type JobRow } from '@cgp/db';
import type { GeneratorRegistry, InputIssue, RegisteredGenerator } from './generators/registry';
import { submitJob, type SubmitDeps } from './submit';

export type EstimateResult =
  | { ok: true; estimate: CreditEstimate; ratesVersion: number }
  | { ok: false; reason: 'unknown_generator' }
  | { ok: false; reason: 'invalid_input'; issues: InputIssue[] };

/** Prices a request without holding anything, for the cost shown before submit. */
export async function estimateGeneration(
  db: Database,
  registry: GeneratorRegistry,
  generatorKey: string,
  raw: unknown,
): Promise<EstimateResult> {
  const generator = registry.get(generatorKey);
  if (!generator) return { ok: false, reason: 'unknown_generator' };
  const rates = await currentMeteringRates(db);
  const prepared = generator.prepare(raw, rates);
  if (!prepared.ok) return { ok: false, reason: 'invalid_input', issues: prepared.issues };
  return { ok: true, estimate: prepared.estimate, ratesVersion: rates.version };
}

/** The fields every generator input shares; the rest are explicit user instructions. */
interface CommonInput {
  intentText: string;
  templateId?: string;
  targetPlatform: TargetPlatform | null;
}

function splitInput(input: unknown) {
  const { intentText, templateId, targetPlatform, ...params } = input as CommonInput &
    Record<string, unknown>;
  return { intentText, templateId, targetPlatform, params };
}

export type CompileGenerationResult =
  | { ok: true; prompt: CompiledPromptView; estimate: CreditEstimate }
  | { ok: false; reason: 'unknown_generator' }
  | { ok: false; reason: 'invalid_input'; issues: InputIssue[] }
  | { ok: false; reason: 'profile_required' | 'brand_kit_required' | 'template_not_found' };

type Prepared =
  | { ok: true; generator: RegisteredGenerator; input: unknown; estimate: CreditEstimate }
  | { ok: false; reason: 'unknown_generator' }
  | { ok: false; reason: 'invalid_input'; issues: InputIssue[] };

async function prepare(
  db: Database,
  registry: GeneratorRegistry,
  generatorKey: string,
  raw: unknown,
): Promise<Prepared> {
  const generator = registry.get(generatorKey);
  if (!generator) return { ok: false, reason: 'unknown_generator' };
  const prepared = generator.prepare(raw, await currentMeteringRates(db));
  if (!prepared.ok) return { ok: false, reason: 'invalid_input', issues: prepared.issues };
  return { ok: true, generator, input: prepared.input, estimate: prepared.estimate };
}

async function compileFor(
  deps: CompileDeps,
  workspaceId: string,
  generator: RegisteredGenerator,
  input: unknown,
) {
  const { intentText, templateId, targetPlatform, params } = splitInput(input);
  return compile(deps, {
    workspaceId,
    outputType: generator.outputType,
    intentText,
    templateId,
    targetPlatform,
    params,
  });
}

/**
 * Plain intent to a compiled prompt the user can read and edit before dispatching it. Holds
 * nothing and charges nothing (FR-PO-14).
 */
export async function compileGeneration(
  deps: { db: Database; registry: GeneratorRegistry; compile: Omit<CompileDeps, 'db'> },
  request: { workspaceId: string; generatorKey: string; input: unknown },
): Promise<CompileGenerationResult> {
  const prepared = await prepare(deps.db, deps.registry, request.generatorKey, request.input);
  if (!prepared.ok) return prepared;
  const compiled = await compileFor(
    { ...deps.compile, db: deps.db },
    request.workspaceId,
    prepared.generator,
    prepared.input,
  );
  if (!compiled.ok) return compiled;
  return { ok: true, prompt: compiled.prompt, estimate: prepared.estimate };
}

export interface GenerationRequest {
  workspaceId: string;
  generatorKey: string;
  input: unknown;
  /**
   * A prompt compiled (and perhaps edited) earlier. Without one the request is compiled now.
   * The input still sets quantities and price; the prompt sets content.
   */
  compiledPromptId?: string;
  correlationId?: string;
}

export type GenerationResult =
  | { ok: true; job: JobView; estimate: CreditEstimate; prompt: CompiledPromptView }
  | Exclude<CompileGenerationResult, { ok: true }>
  | { ok: false; reason: 'prompt_not_found' }
  | { ok: false; reason: 'blocked'; category: ModerationCategory }
  | {
      ok: false;
      reason: 'workspace_not_found' | 'insufficient_credits' | 'insufficient_video_seconds';
    };

export interface GenerationDeps extends SubmitDeps {
  registry: GeneratorRegistry;
  compile: Omit<CompileDeps, 'db'>;
  moderation: ModerationAdapter;
}

/**
 * The one path from a request to a queued job, for every generator (plan section 5): parse
 * and price, compile (or take the prompt the user edited), check the compiled prompt, and
 * only then hold credits and enqueue. A blocked prompt never creates a job or a hold
 * (invariant 10).
 */
export async function startGeneration(
  deps: GenerationDeps,
  request: GenerationRequest,
): Promise<GenerationResult> {
  const prepared = await prepare(deps.db, deps.registry, request.generatorKey, request.input);
  if (!prepared.ok) return prepared;
  const { generator, estimate } = prepared;

  let prompt: CompiledPromptView;
  if (request.compiledPromptId) {
    const row = await findCompiledPrompt(deps.db, request.workspaceId, request.compiledPromptId);
    if (!row || row.outputType !== generator.outputType) {
      return { ok: false, reason: 'prompt_not_found' };
    }
    prompt = toView(row);
  } else {
    const compiled = await compileFor(
      { ...deps.compile, db: deps.db },
      request.workspaceId,
      generator,
      prepared.input,
    );
    if (!compiled.ok) return compiled;
    prompt = compiled.prompt;
  }

  const verdict = await deps.moderation.checkText(prompt.text);
  if (!verdict.allowed) {
    const category = verdict.flagged[0]?.category ?? 'other';
    deps.log.info({ compiledPromptId: prompt.id, category }, 'compiled prompt blocked');
    return { ok: false, reason: 'blocked', category };
  }

  const submitted = await submitJob(deps, {
    workspaceId: request.workspaceId,
    jobClass: generator.jobClass,
    generatorKey: generator.key,
    input: { ...(prepared.input as object), compiledPromptId: prompt.id },
    estimate,
    correlationId: request.correlationId,
    compiledPromptId: prompt.id,
  });
  if (!submitted.ok) return submitted;
  return { ok: true, job: toJobView(submitted.job), estimate, prompt };
}

/** A job as the API shows it, or undefined when it is not in this workspace. */
export async function findJob(
  db: Database,
  workspaceId: string,
  jobId: string,
): Promise<JobView | undefined> {
  // Ids arrive from URLs; a malformed one is simply not found, never a database error.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(jobId)) {
    return undefined;
  }
  const [row] = await scoped(db, workspaceId).select(jobs, {
    where: (t, op) => op.eq(t.id, jobId),
    limit: 1,
  });
  return row ? toJobView(row) : undefined;
}

export function toJobView(row: JobRow): JobView {
  const error = row.error as { code?: unknown; message?: unknown; category?: unknown } | null;
  return {
    id: row.id,
    generatorKey: row.generatorKey,
    jobClass: row.jobClass,
    status: row.status,
    held: { credits: row.creditsHeld, videoSeconds: row.videoSecondsHeld },
    settled:
      row.creditsSettled === null
        ? null
        : { credits: row.creditsSettled, videoSeconds: row.videoSecondsSettled ?? 0 },
    error: error
      ? {
          code: typeof error.code === 'string' ? error.code : 'UNKNOWN',
          message: typeof error.message === 'string' ? error.message : '',
          ...(typeof error.category === 'string' ? { category: error.category } : {}),
        }
      : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
