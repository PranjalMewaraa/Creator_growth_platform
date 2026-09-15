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
