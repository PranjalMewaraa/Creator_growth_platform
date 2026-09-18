import type { CreditEstimate, JobView } from '@cgp/contracts';
import { currentMeteringRates, jobs, scoped, type Database, type JobRow } from '@cgp/db';
import type { GeneratorRegistry, InputIssue } from './generators/registry';
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

export interface GenerationRequest {
  workspaceId: string;
  generatorKey: string;
  input: unknown;
  correlationId?: string;
}

export type GenerationResult =
  | { ok: true; job: JobView; estimate: CreditEstimate }
  | { ok: false; reason: 'unknown_generator' }
  | { ok: false; reason: 'invalid_input'; issues: InputIssue[] }
  | {
      ok: false;
      reason: 'workspace_not_found' | 'insufficient_credits' | 'insufficient_video_seconds';
    };

/**
 * The one path from a request to a queued job, for every generator. The input is parsed and
 * priced by the generator's own definition, then held and enqueued by the job engine.
 *
 * Orchestration (WP10) and the moderation pre check (WP11) go between pricing and the hold:
 * compile, check the compiled prompt, persist it, and only then create the job. Until then
 * the worker has no handler for these generators, so a job fails and is refunded in full
 * without calling any provider.
 */
export async function startGeneration(
  deps: SubmitDeps & { registry: GeneratorRegistry },
  request: GenerationRequest,
): Promise<GenerationResult> {
  const generator = deps.registry.get(request.generatorKey);
  if (!generator) return { ok: false, reason: 'unknown_generator' };

  const rates = await currentMeteringRates(deps.db);
  const prepared = generator.prepare(request.input, rates);
  if (!prepared.ok) return { ok: false, reason: 'invalid_input', issues: prepared.issues };

  const submitted = await submitJob(deps, {
    workspaceId: request.workspaceId,
    jobClass: generator.jobClass,
    generatorKey: generator.key,
    input: prepared.input,
    estimate: prepared.estimate,
    correlationId: request.correlationId,
  });
  if (!submitted.ok) return submitted;
  return { ok: true, job: toJobView(submitted.job), estimate: prepared.estimate };
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
