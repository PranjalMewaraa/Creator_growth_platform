import type { JobView, ObjectStore, OutputType, TextLayerSpec } from '@cgp/contracts';
import {
  jobs,
  listScenes,
  outputs,
  PUBLISH_TARGET,
  renditionsFor,
  scoped,
  type Database,
} from '@cgp/db';
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
  /** The composited text layer, when one has been saved over this picture (WP18). */
  rendition: { id: string; url: string; spec: TextLayerSpec } | null;
  /**
   * The scenes as stills, before anything was filmed (WP26), each with the shot it is of, so
   * the filmstrip can say what the frame is meant to be rather than only numbering it (WP46).
   */
  storyboard: Array<{ index: number; url: string; prompt: string }> | null;
  /**
   * The scenes a reel was filmed from (WP22), so one of them can be filmed again without the
   * other two (WP50). Null for everything that is not a finished reel.
   */
  scenes: Array<{
    id: string;
    index: number;
    clipUrl: string | null;
    prompt: string;
    regeneratedCount: number;
  }> | null;
  compiledPromptId: string;
  createdAt: string;
}

/** The storyboard frames, when this output is one. */
function storyboard(metadata: unknown): StudioOutput['storyboard'] {
  const frames = (metadata as { storyboard?: unknown } | null)?.storyboard;
  if (!Array.isArray(frames)) return null;
  const usable = frames.flatMap((frame) => {
    const { index, url, prompt } = (frame ?? {}) as Record<string, unknown>;
    return typeof url === 'string' && typeof index === 'number'
      ? [{ index, url, prompt: typeof prompt === 'string' ? prompt : '' }]
      : [];
  });
  return usable.length > 0 ? usable : null;
}

/**
 * The stored media fields, when the row has them and they are the shape they should be. A
 * video keeps them under `reel`, since the scenes are media of their own.
 */
function media(metadata: unknown): StudioOutput['media'] {
  const record = (metadata ?? {}) as Record<string, unknown>;
  const reel = record.reel as Record<string, unknown> | undefined;
  const { url, width, height } = reel ?? record;
  if (typeof url !== 'string' || url.length === 0) return null;
  return {
    url,
    width: typeof width === 'number' ? width : 0,
    height: typeof height === 'number' ? height : 0,
  };
}

/**
 * A job's outputs, or nothing when the job is not in this workspace or has none yet. The store
 * is needed only to say where a composited layer lives; renditions keep a key, not a URL.
 */
export async function jobOutputs(
  db: Database,
  workspaceId: string,
  jobId: string,
  store: Pick<ObjectStore, 'publicUrl'>,
): Promise<StudioOutput[]> {
  if (!UUID.test(jobId)) return [];
  const rows = await scoped(db, workspaceId).select(outputs, {
    where: (t, op) => op.eq(t.jobId, jobId),
    orderBy: (t, order) => order.asc(t.createdAt),
  });
  // Whatever has been composited over these pictures since, so the editor reopens on the
  // layer that is already there rather than on a blank one.
  const layers = await renditionsFor(
    db,
    workspaceId,
    rows.map((row) => row.id),
  );
  // A reel's scenes, so the Studio can offer to film one again. Asked for only when there is
  // a reel to ask about: every other output type has none, and a query per output would be
  // three round trips to learn that.
  const reel = rows.find((row) => row.kind === 'video' && media(row.metadata) !== null);
  const scenes = reel ? await listScenes(db, workspaceId, reel.id) : [];
  return rows.map((row) => {
    const layer = layers.find((rendition) => rendition.outputId === row.id);
    return {
      id: row.id,
      kind: row.kind,
      text: text((row.metadata as { text?: unknown }).text),
      media: media(row.metadata),
      storyboard: storyboard(row.metadata),
      scenes:
        row.id === reel?.id && scenes.length > 0
          ? scenes.map((scene) => ({
              id: scene.id,
              index: scene.index,
              clipUrl: scene.clipUrl,
              prompt: scene.prompt,
              regeneratedCount: scene.regeneratedCount,
            }))
          : null,
      rendition: layer
        ? {
            id: layer.id,
            url: store.publicUrl(layer.storageKey),
            spec: layer.spec as TextLayerSpec,
          }
        : null,
      compiledPromptId: row.compiledPromptId,
      createdAt: row.createdAt.toISOString(),
    };
  });
}
