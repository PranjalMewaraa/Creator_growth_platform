import type { JobView, OutputType } from '@cgp/contracts';
import { jobs, outputs, PUBLISH_TARGET, scoped, type Database } from '@cgp/db';
import { toJobView } from './generate';

// What the Studio needs beyond starting a job: the recent jobs to come back to, and a finished
// job's output.

export interface StudioJob extends JobView {
  /** What the user asked for, from the job's input. */
  intentText: string;
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
    .map((row) => ({
      ...toJobView(row),
      intentText: text((row.input as { intentText?: unknown }).intentText),
    }));
}

export interface StudioOutput {
  id: string;
  kind: OutputType;
  /** Plain text, or JSON text for generators that answer in JSON. */
  text: string;
  compiledPromptId: string;
  createdAt: string;
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
    compiledPromptId: row.compiledPromptId,
    createdAt: row.createdAt.toISOString(),
  }));
}
