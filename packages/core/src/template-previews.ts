import type { Logger } from '@cgp/config';
import type {
  ImageAdapter,
  ModerationAdapter,
  ObjectStore,
  TextAdapter,
  TokenUsage,
} from '@cgp/contracts';
import {
  catalog,
  deleteTemplatePreview,
  jobs as jobsTable,
  outputs,
  saveTemplatePreview,
  scoped,
  templatePreviews,
  templates,
  templateVersions,
  type Database,
} from '@cgp/db';
import { startGeneration } from './generate';
import type { GeneratorRegistry } from './generators/registry';
import { createImageHandlers } from './handlers/image';
import { createStoryboardHandler } from './handlers/storyboard';
import { createTextHandlers } from './handlers/text';
import { createVideoHandlers, type VideoHandlerDeps } from './handlers/video';
import { processJob } from './process';
import type { Queues } from './queues';

/**
 * The preview pipeline (WP19, invariant 14): every gallery preview is real output from that
 * template version, made by running the template through its own generator. Nothing here
 * fabricates an image or writes copy: if a template cannot produce output, it has no preview
 * and the gallery says so.
 *
 * Runs the job in this process rather than through the queue, because the point is to finish
 * and record the result, not to exercise the worker. The credits are spent from the workspace
 * it runs in, and the provider calls are real when PROVIDERS is.
 */

/** What each output type is asked for, so a preview shows the template rather than the intent. */
const INTENTS: Record<string, string> = {
  script: 'Cold brew coffee, brewed slowly and delivered across Jaipur the same morning',
  hook: 'Cold brew coffee, brewed slowly and delivered across Jaipur the same morning',
  caption: 'Cold brew coffee, brewed slowly and delivered across Jaipur the same morning',
  image: 'A bottle of cold brew coffee on a balcony table in the morning',
  thumbnail: 'A barista pouring cold brew over ice, caught mid pour',
  // One scene, not three: a preview has to be real (invariant 14), not expensive.
  video: 'A bottle of cold brew coffee on a balcony table in the morning',
};

/** A video preview is one scene. Three would cost three times as much to say the same thing. */
const PREVIEW_SCENE_COUNT = 1;

/**
 * Jobs are never queued here. The pipeline runs each one in this process, and enqueuing as
 * well would hand the same job to a running worker, which then generates it a second time
 * against the real providers and can refund it out from under this run. A job already RUNNING
 * is accepted by design, for crash recovery, so nothing downstream stops the double run.
 */
const NOT_QUEUED = {
  inference: { add: () => Promise.resolve() },
  render: { add: () => Promise.resolve() },
  publish: { add: () => Promise.resolve() },
} as unknown as Queues;

export interface TemplatePreviewDeps {
  db: Database;
  store: ObjectStore;
  /** Realised cost per call, so a preview run shows up in telemetry like any other work. */
  textCostInr: (adapterKey: string, usage: TokenUsage) => number;
  imageCostInr: (adapterKey: string, usage: TokenUsage) => number;
  moderation: ModerationAdapter;
  registry: GeneratorRegistry;
  text: Readonly<Record<string, TextAdapter>>;
  image: Readonly<Record<string, ImageAdapter>>;
  rewriters: TextAdapter[];
  log: Logger;
  /**
   * What it takes to film: a video template's preview is a real reel (invariant 14), which
   * costs provider time and the workspace's video seconds. Absent, video templates are
   * skipped and say so rather than showing something they did not make.
   */
  video?: Pick<
    VideoHandlerDeps,
    'adapters' | 'planner' | 'ffmpeg' | 'costInr' | 'voice' | 'voiceCostInr'
  >;
}

export interface PreviewOutcome {
  slug: string;
  outputType: string;
  status: 'made' | 'skipped' | 'failed';
  detail?: string;
}

/**
 * Generates a preview for every template that has none, or for every template when `force` is
 * set. Video is skipped until the video generator exists. Returns what happened to each.
 */
export async function buildTemplatePreviews(
  deps: TemplatePreviewDeps,
  workspaceId: string,
  options: { force?: boolean; only?: string[] } = {},
): Promise<PreviewOutcome[]> {
  const cat = catalog(deps.db);
  const [allTemplates, versions, existing] = await Promise.all([
    cat.select(templates, { orderBy: (t, order) => order.asc(t.slug) }),
    cat.select(templateVersions),
    cat.select(templatePreviews),
  ]);

  const handlers = {
    ...createTextHandlers({
      db: deps.db,
      registry: deps.registry,
      adapters: deps.text,
      moderation: deps.moderation,
      publishDelta: () => Promise.resolve(),
      costInr: deps.textCostInr,
      providerLabel: 'preview',
    }),
    ...createImageHandlers({
      db: deps.db,
      registry: deps.registry,
      adapters: deps.image,
      moderation: deps.moderation,
      store: deps.store,
      costInr: deps.imageCostInr,
      providerLabel: 'preview',
    }),
    ...createStoryboardHandler({
      db: deps.db,
      registry: deps.registry,
      adapters: deps.image,
      planner: deps.rewriters[0],
      moderation: deps.moderation,
      store: deps.store,
      costInr: deps.imageCostInr,
      providerLabel: 'preview',
    }),
    ...(deps.video
      ? createVideoHandlers({
          db: deps.db,
          registry: deps.registry,
          moderation: deps.moderation,
          store: deps.store,
          providerLabel: 'preview',
          ...deps.video,
        })
      : {}),
  };

  const outcomes: PreviewOutcome[] = [];
  for (const template of allTemplates) {
    const version = versions.find(
      (row) => row.templateId === template.id && row.version === template.currentVersion,
    );
    const skip = (detail: string): void => {
      outcomes.push({
        slug: template.slug,
        outputType: template.outputType,
        status: 'skipped',
        detail,
      });
    };
    if (!version) {
      skip('no current version');
      continue;
    }
    if (options.only && !options.only.includes(template.slug)) continue;
    if (!options.force && existing.some((row) => row.templateVersionId === version.id)) {
      skip('already has one');
      continue;
    }
    const generator = generatorFor(deps.registry, template.outputType);
    if (!generator || !handlers[generator.key]) {
      skip(`no handler for ${template.outputType}`);
      continue;
    }

    try {
      const preview = await withQuotaRetry(deps, () =>
        runOne(deps, handlers, workspaceId, {
          templateId: template.id,
          generatorKey: generator.key,
          outputType: template.outputType,
        }),
      );
      await saveTemplatePreview(deps.db, {
        templateVersionId: version.id,
        mediaUrl: preview.mediaUrl,
        text: preview.text,
      });
      outcomes.push({ slug: template.slug, outputType: template.outputType, status: 'made' });
      deps.log.info({ template: template.slug }, 'preview made');
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      // A forced run that could not replace the preview drops it: keeping the last one would
      // show an older run's output as if it were this version's.
      if (options.force) await deleteTemplatePreview(deps.db, version.id);
      outcomes.push({
        slug: template.slug,
        outputType: template.outputType,
        status: 'failed',
        detail,
      });
      deps.log.warn({ err, template: template.slug }, 'preview failed');
    }
  }
  return outcomes;
}

/** Long enough for a per minute image quota to refill. */
const QUOTA_WAIT_MS = 45_000;

/**
 * Image models meter by the minute, and a gallery run asks for every picture at once, so the
 * last few reliably come back 429. A refused template waits for the window and tries again
 * rather than keeping whatever preview it had, which would be the previous run's.
 */
async function withQuotaRetry<T>(deps: TemplatePreviewDeps, work: () => Promise<T>): Promise<T> {
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

/**
 * The generator that makes an output type. Video has two, because the storyboard compiles as
 * one to reach the profile that plans scenes; the render class is the one that makes the
 * thing itself, and a preview has to be the thing (invariant 14).
 */
function generatorFor(registry: GeneratorRegistry, outputType: string) {
  const matching = registry.list().filter((entry) => entry.outputType === outputType);
  return matching.find((entry) => entry.jobClass === 'render') ?? matching[0];
}

/** One template, compiled, generated and settled, with whatever it produced read back. */
async function runOne(
  deps: TemplatePreviewDeps,
  handlers: Record<string, Parameters<typeof processJob>[0]['handlers'][string]>,
  workspaceId: string,
  template: { templateId: string; generatorKey: string; outputType: string },
): Promise<{ mediaUrl: string | null; text: string | null }> {
  const started = await startGeneration(
    {
      db: deps.db,
      queues: NOT_QUEUED,
      log: deps.log,
      registry: deps.registry,
      compile: { rewriters: deps.rewriters },
      moderation: deps.moderation,
    },
    {
      workspaceId,
      generatorKey: template.generatorKey,
      input: {
        intentText: INTENTS[template.outputType] ?? 'A short post about cold brew coffee',
        templateId: template.templateId,
        targetPlatform: 'instagram',
        ...(template.outputType === 'video' ? { sceneCount: PREVIEW_SCENE_COUNT } : {}),
      },
    },
  );
  if (!started.ok) throw new Error(started.reason);

  const result = await processJob(
    { db: deps.db, handlers, log: deps.log },
    {
      jobId: started.job.id,
      correlationId: started.job.id,
    },
  );
  if (result !== 'settled') {
    // Carry the job's own reason up, so a quota refusal can be waited out rather than reported
    // as a bare refund.
    const [job] = await scoped(deps.db, workspaceId).select(jobsTable, {
      where: (t, op) => op.eq(t.id, started.job.id),
      limit: 1,
    });
    const reason = (job?.error as { message?: string } | null)?.message;
    throw new Error(reason ? `job ${result}: ${reason}` : `job ${result}`);
  }

  const [output] = await scoped(deps.db, workspaceId).select(outputs, {
    where: (t, op) => op.eq(t.jobId, started.job.id),
    limit: 1,
  });
  if (!output) throw new Error('no output');
  const metadata = output.metadata as { text?: unknown; url?: unknown; reel?: unknown };
  // A reel keeps its URL under `reel`, since its scenes are media of their own.
  const reel = (metadata.reel as { url?: unknown } | undefined)?.url;
  return {
    mediaUrl:
      typeof reel === 'string' ? reel : typeof metadata.url === 'string' ? metadata.url : null,
    text: typeof metadata.text === 'string' ? metadata.text : null,
  };
}
