import type { Logger } from '@cgp/config';
import {
  isAdapterError,
  REQUIREMENTS_HEADING,
  type TextAdapter,
  type TokenUsage,
} from '@cgp/contracts';
import { MAX_BRIEF_CHARS } from './render';

/** Invariant 11: the rewrite pass gets 1500ms in total, retries included. */
export const REWRITE_BUDGET_MS = 1500;

export type RewriteOutcome =
  | { fallbackUsed: false; brief: string; provider: string; usage: TokenUsage; elapsedMs: number }
  | {
      fallbackUsed: true;
      brief: string;
      reason: 'timeout' | 'provider_error' | 'invalid_output';
      elapsedMs: number;
    };

export interface RewriteOptions {
  brief: string;
  system: string;
  maxOutputTokens: number;
  /** Tried in order, one attempt each: a bounded retry that moves to the second provider. */
  providers: TextAdapter[];
  budgetMs?: number;
  log?: Logger;
}

function acceptable(text: string): boolean {
  const trimmed = text.trim();
  return (
    trimmed.length > 0 &&
    trimmed.length <= MAX_BRIEF_CHARS &&
    !trimmed.includes(REQUIREMENTS_HEADING)
  );
}

/**
 * Stage 2. Never throws and never fails a generation: on a breach, an error from every
 * provider, or unusable output, it returns the stage 1 brief marked as a fallback. It holds
 * and charges nothing; prompt compile is absorbed (FR-PO-14).
 */
export async function rewriteBrief(options: RewriteOptions): Promise<RewriteOutcome> {
  const started = performance.now();
  const elapsed = () => Math.round(performance.now() - started);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.budgetMs ?? REWRITE_BUDGET_MS);
  let reason: 'timeout' | 'provider_error' | 'invalid_output' = 'provider_error';

  try {
    for (const provider of options.providers) {
      if (controller.signal.aborted) {
        reason = 'timeout';
        break;
      }
      try {
        const result = await provider.generate({
          prompt: options.brief,
          system: options.system,
          maxOutputTokens: options.maxOutputTokens,
          temperature: 0.4,
          reasoning: 'minimal',
          signal: controller.signal,
        });
        if (result.finishReason === 'stop' && acceptable(result.text)) {
          return {
            fallbackUsed: false,
            brief: result.text.trim(),
            provider: provider.key,
            usage: result.usage,
            elapsedMs: elapsed(),
          };
        }
        reason = 'invalid_output';
        options.log?.warn(
          { provider: provider.key, finishReason: result.finishReason },
          'rewrite output unusable',
        );
      } catch (err) {
        const aborted =
          controller.signal.aborted || (isAdapterError(err) && err.code === 'ABORTED');
        reason = aborted ? 'timeout' : 'provider_error';
        options.log?.warn({ provider: provider.key, err }, 'rewrite attempt failed');
        if (aborted) break;
      }
    }
  } finally {
    clearTimeout(timer);
  }

  options.log?.info({ reason, elapsedMs: elapsed() }, 'rewrite fell back to the stage 1 brief');
  return { fallbackUsed: true, brief: options.brief, reason, elapsedMs: elapsed() };
}
