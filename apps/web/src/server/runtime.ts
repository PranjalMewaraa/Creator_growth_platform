import 'server-only';
import { createDatabase, type Database } from '@cgp/db';
import { createQueues, createRedis, type Queues } from '@cgp/core';
import type { Redis } from 'ioredis';
import { baseEnvSchema, createLogger, parseEnv, type Logger } from '@cgp/config';
import { z } from 'zod';

const webEnvSchema = baseEnvSchema.extend({
  /** Signs session cookies and magic link tokens. Generate per environment. */
  AUTH_SECRET: z.string().min(32),
  APP_URL: z.url().default('http://localhost:3000'),
  /**
   * How mail leaves (WP51): Resend when it has a key, any SMTP relay when it has a URL, the
   * server log when it has neither. EMAIL_FROM is what the message says it is from; Resend
   * can do without it in testing, an SMTP relay cannot.
   */
  EMAIL_FROM: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
  SMTP_URL: z.string().url().optional(),
  /**
   * Lets a workspace that cannot complete real OAuth (the Meta and LinkedIn apps are still in
   * developer mode, so only accounts the team added as testers can consent) borrow the team's
   * own connected account instead, so a demo still shows a real post going out (WP52). Off by
   * default: this makes every post from a borrowing workspace land on the team's real,
   * visible account, which is not something to turn on without meaning to.
   */
  DEMO_ACCOUNT_SHARING: z.enum(['off', 'on']).default('off'),
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

const shared = globalThis as typeof globalThis & { cgpRedis?: Redis; cgpQueues?: Queues };

/** One Redis connection per server process, shared by the queues; subscribers duplicate it. */
export function getRedis(): Redis {
  return (shared.cgpRedis ??= createRedis(getEnv().REDIS_URL));
}

export function getQueues(): Queues {
  return (shared.cgpQueues ??= createQueues(getRedis()));
}
