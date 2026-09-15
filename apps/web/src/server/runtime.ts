import 'server-only';
import { baseEnvSchema, createLogger, parseEnv, type BaseEnv, type Logger } from '@cgp/config';

let env: BaseEnv | undefined;
let logger: Logger | undefined;

/** Parsed on first use, not at import, so `next build` runs without runtime secrets. */
export function getEnv(): BaseEnv {
  return (env ??= parseEnv(baseEnvSchema));
}

export function getLogger(): Logger {
  return (logger ??= createLogger({ service: 'web', level: getEnv().LOG_LEVEL }));
}
