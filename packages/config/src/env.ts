import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
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
  /** The GCP project Vertex bills. Required when PROVIDERS=real. */
  GOOGLE_CLOUD_PROJECT: z.string().min(1).optional(),
  /**
   * The ffmpeg the render worker runs (plan section 4.6). It needs libx264, AAC and libass.
   * A name is looked up on PATH; a path is used as given. Renders fail without one, and
   * nothing else does.
   */
  FFMPEG_PATH: z.string().min(1).default('ffmpeg'),
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

/**
 * Local dev keeps one .env at the repo root. Walks up from startDir to the workspace
 * root and loads its .env if present. Deployed environments have no file and set real
 * env vars instead, which this never overrides.
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
