/**
 * How a caller reacts to a failed provider or platform call (plan section 14).
 * - retriable: back off exponentially, bounded attempts.
 * - reauth: the connected account must be reconnected.
 * - terminal: never retry. A policy rejection retried risks application suspension.
 * - quota: requeue into the next window without consuming an attempt.
 */
export const FAILURE_CATEGORIES = ['retriable', 'reauth', 'terminal', 'quota'] as const;

export type FailureCategory = (typeof FAILURE_CATEGORIES)[number];

export interface NormalizedError {
  code: string;
  message: string;
  category: FailureCategory;
  retryAfterMs?: number;
}

/**
 * The only error that crosses the adapter boundary (invariant 3). Adapters log the raw
 * provider error themselves and throw this. The raw error is deliberately not attached
 * as `cause`, so nothing provider shaped reaches application code.
 */
export class AdapterError extends Error implements NormalizedError {
  override readonly name = 'AdapterError';
  readonly code: string;
  readonly category: FailureCategory;
  // `declare` so the property exists only when set, rather than as an own `undefined`.
  declare readonly retryAfterMs?: number;

  constructor({ code, message, category, retryAfterMs }: NormalizedError) {
    super(message);
    this.code = code;
    this.category = category;
    if (retryAfterMs !== undefined) this.retryAfterMs = retryAfterMs;
  }
}

/** Checks shape rather than `instanceof`, which fails when a bundler duplicates this module. */
export function isAdapterError(err: unknown): err is AdapterError {
  if (!(err instanceof Error) || err.name !== 'AdapterError') return false;
  const { code, category } = err as Partial<AdapterError>;
  return typeof code === 'string' && FAILURE_CATEGORIES.some((c) => c === category);
}
