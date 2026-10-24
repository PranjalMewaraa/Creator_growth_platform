import { existsSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { z } from 'zod';

/** Variables every process needs. Apps extend this with their own. */
export const baseEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_URL: z.url(),
  REDIS_URL: z.url(),
  // Real provider calls spend trial credit, so they are opt in.
  PROVIDERS: z.enum(['fake', 'real']).default('fake'),
  /**
   * Which moderation service checks compiled prompts and output (D3). 'google' is Cloud Natural
   * Language and Vision SafeSearch; 'fake' allows everything but FAKE_BLOCK markers.
   */
  MODERATION: z.enum(['fake', 'google']).default('fake'),
  /**
   * Real publishing makes public posts, so it has its own switch, off by default. With 'fake'
   * the publishers pretend and nothing leaves the machine.
   */
  PUBLISHING: z.enum(['fake', 'real']).default('fake'),
  /** Media bucket (D1 revisited: GCS in the GCP project for now). Needed for uploads. */
  GCS_BUCKET: z.string().min(1).optional(),
  /** Wraps the per token data keys (D11). 32 bytes, base64url. Needed to store or use tokens. */
  TOKEN_ENCRYPTION_KEY: z.string().min(1).optional(),
  /**
   * The apps a person connects their accounts to (WP28, S-03). Instagram's client id is the
   * Instagram app's, which is not the Meta app id beside it. Without a pair, that platform's
   * connect button says so rather than failing at the platform.
   */
  INSTAGRAM_CLIENT_ID: z.string().min(1).optional(),
  INSTAGRAM_CLIENT_SECRET: z.string().min(1).optional(),
  LINKEDIN_CLIENT_ID: z.string().min(1).optional(),
  LINKEDIN_CLIENT_SECRET: z.string().min(1).optional(),
  /** The GCP project Vertex bills. Required when PROVIDERS=real. */
  GOOGLE_CLOUD_PROJECT: z.string().min(1).optional(),
  /**
   * Base64'd service-account JSON, for hosts with no filesystem for GOOGLE_APPLICATION_CREDENTIALS
   * (Vercel). Handed to GoogleAuth as in-memory credentials instead of a file path. Unset on a
   * host that already has a file (the worker's Dockerfile) or real ADC (Cloud Run).
   */
  GOOGLE_CREDENTIALS_B64: z.string().min(1).optional(),
  /**
   * The ffmpeg the render worker runs (plan section 4.6). It needs libx264, AAC and libass.
   * A name is looked up on PATH; a path is used as given. Renders fail without one, and
   * nothing else does.
   */
  FFMPEG_PATH: z.string().min(1).default('ffmpeg'),
  /**
   * Trend Radar's YouTube source (WP61), from Google Cloud Console — free tier, 10k units/day.
   * Optional, same as the publishing OAuth pairs above: without it, ingestion simply skips
   * YouTube and still runs on Autocomplete and Reddit.
   */
  YOUTUBE_API_KEY: z.string().min(1).optional(),
  /** How often the worker re-ingests trends. Six hours by default, matching the plan. */
  TRENDS_INGEST_EVERY_MS: z.coerce.number().int().positive().default(6 * 60 * 60 * 1000),
  /** The niches ingested every tick, comma separated. */
  TRENDS_NICHES: z
    .string()
    .min(1)
    .default('creator economy,tech,ai,finance,fitness')
    .transform((v) => v.split(',').map((s) => s.trim()).filter(Boolean)),
});

export type BaseEnv = z.infer<typeof baseEnvSchema>;

export function parseEnv<T extends z.ZodType>(
  schema: T,
  source: Record<string, string | undefined> = process.env,
): z.infer<T> {
  const result = schema.safeParse(source);
  if (!result.success) {
    throw new Error(`Invalid environment:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}

/** The workspace root, found by walking up from a directory, or nothing outside a workspace. */
export function workspaceRoot(startDir: string = process.cwd()): string | undefined {
  let dir = startDir;
  for (;;) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/**
 * A tool path from the environment, made absolute. A relative one is resolved against the
 * workspace root rather than the process's own directory: `pnpm --filter` runs a script from
 * inside its package, so `tools/ffmpeg/ffmpeg.exe` means the repository's copy wherever the
 * process happens to start. A bare name is left alone for PATH to find.
 */
export function resolveToolPath(value: string, startDir: string = process.cwd()): string {
  if (!/[/\\]/.test(value)) return value;
  if (isAbsolute(value)) return value;
  const root = workspaceRoot(startDir);
  return root ? join(root, value) : value;
}

/**
 * Local dev keeps one .env at the repo root. Walks up from startDir to the workspace root and
 * loads its .env if present. Deployed environments have no file and set real env vars instead,
 * which this never overrides.
 */
export function loadRootEnvFile(startDir: string = process.cwd()): string | undefined {
  let dir = startDir;
  for (;;) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) {
      const file = join(dir, '.env');
      if (!existsSync(file)) return undefined;
      process.loadEnvFile(file);
      return file;
    }
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}
