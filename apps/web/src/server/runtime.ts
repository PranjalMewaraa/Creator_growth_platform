import 'server-only';
import { createDatabase, type Database } from '@cgp/db';
import { baseEnvSchema, createLogger, parseEnv, type Logger } from '@cgp/config';
import { z } from 'zod';

const webEnvSchema = baseEnvSchema.extend({
  /** Signs session cookies and magic link tokens. Generate per environment. */
  AUTH_SECRET: z.string().min(32),
  APP_URL: z.url().default('http://localhost:3000'),
  /** Without a sender, magic links are written to the server log (development only). */
  EMAIL_FROM: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
});

export type WebEnv = z.infer<typeof webEnvSchema>;

let env: WebEnv | undefined;
let logger: Logger | undefined;

/** Parsed on first use, not at import, so `next build` runs without runtime secrets. */
export function getEnv(): WebEnv {
  return (env ??= parseEnv(webEnvSchema));
}

export function getLogger(): Logger {
  return (logger ??= createLogger({ service: 'web', level: getEnv().LOG_LEVEL }));
}

// Dev reloads re-evaluate modules, so the pool is cached globally to avoid leaking connections.
const pool = globalThis as typeof globalThis & { cgpDb?: Database };

export function getDb(): Database {
  return (pool.cgpDb ??= createDatabase(getEnv().DATABASE_URL));
}
