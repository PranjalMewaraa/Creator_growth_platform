import type { JobView, OutputType } from '@cgp/contracts';
import { jobs, outputs, PUBLISH_TARGET, scoped, type Database } from '@cgp/db';
import { toJobView } from './generate';

// What the Studio needs beyond starting a job: the recent jobs to come back to, and a finished
// job's output.

export interface StudioJob extends JobView {
  /** What the user asked for, from the job's input. */
  intentText: string;
  /** The length a script was asked for, so its output can be measured against it (S-10). */
  durationSeconds: number | null;
}

/** A stored JSON field that should be a string, or empty when it is anything else. */
function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Newest generation jobs first; publish jobs belong to the Composer, not here. */
export async function recentGenerationJobs(
  db: Database,
  workspaceId: string,
  limit = 12,
): Promise<StudioJob[]> {
  const rows = await scoped(db, workspaceId).select(jobs, {
    where: (t, op) => op.ne(t.generatorKey, PUBLISH_TARGET),
    orderBy: (t, order) => order.desc(t.createdAt),
    limit,
  });
  return rows
    .filter((row) => row.generatorKey !== 'noop')
    .map((row) => {
      const input = row.input as { intentText?: unknown; durationSeconds?: unknown };
      return {
        ...toJobView(row),
        intentText: text(input.intentText),
        durationSeconds: typeof input.durationSeconds === 'number' ? input.durationSeconds : null,
      };
    });
}

export interface StudioOutput {
  id: string;
  kind: OutputType;
  /** Plain text, or JSON text for generators that answer in JSON. Empty for media. */
  text: string;
  /** Where the picture is, for the output types that make one. */
  media: { url: string; width: number; height: number } | null;
  compiledPromptId: string;
  createdAt: string;
}

/** The stored media fields, when the row has them and they are the shape they should be. */
function media(metadata: unknown): StudioOutput['media'] {
  const { url, width, height } = (metadata ?? {}) as Record<string, unknown>;
  if (typeof url !== 'string' || url.length === 0) return null;
  return {
    url,
    width: typeof width === 'number' ? width : 0,
    height: typeof height === 'number' ? height : 0,
  };
}

/** A job's outputs, or nothing when the job is not in this workspace or has none yet. */
export async function jobOutputs(
  db: Database,
  workspaceId: string,
  jobId: string,
): Promise<StudioOutput[]> {
  if (!UUID.test(jobId)) return [];
  const rows = await scoped(db, workspaceId).select(outputs, {
    where: (t, op) => op.eq(t.jobId, jobId),
    orderBy: (t, order) => order.asc(t.createdAt),
  });
  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    text: text((row.metadata as { text?: unknown }).text),
    media: media(row.metadata),
    compiledPromptId: row.compiledPromptId,
    createdAt: row.createdAt.toISOString(),
  }));
}
