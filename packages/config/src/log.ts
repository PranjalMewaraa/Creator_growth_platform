import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { pino, type DestinationStream, type Logger } from 'pino';

/**
 * One correlation id spans request, compile, job, render and provider call.
 * It rides in AsyncLocalStorage within a process and in job data across the queue.
 */
const context = new AsyncLocalStorage<{ correlationId: string }>();

export function withCorrelation<T>(correlationId: string | undefined, fn: () => T): T {
  return context.run({ correlationId: correlationId ?? randomUUID() }, fn);
}

export function currentCorrelationId(): string | undefined {
  return context.getStore()?.correlationId;
}

export interface LoggerOptions {
  service: string;
  level?: string;
  destination?: DestinationStream;
}

export function createLogger({ service, level = 'info', destination }: LoggerOptions): Logger {
  const options = {
    level,
    base: { service },
    mixin() {
      const correlationId = currentCorrelationId();
      return correlationId ? { correlationId } : {};
    },
  };
  return destination ? pino(options, destination) : pino(options);
}

export type { Logger };
