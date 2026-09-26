import type { Logger } from '@cgp/config';
import type { CompilerProfileConfig, TextAdapter } from '@cgp/contracts';

/**
 * What is said over a reel (WP23). Written by the engine from the compiled prompt and the
 * scenes it planned, never by the generator (invariant 4), and shaped by versioned config like
 * everything else.
 *
 * One line per scene, because one line is also one caption segment: the voice's own timings
 * then place the captions, which is invariant 13 and the reason captions are never
 * transcribed from the render.
 */

export const VOICEOVER_BUDGET_MS = 20_000;

export interface VoiceoverPlan {
  /** One line per scene, in order. Empty when the reel is to stay silent. */
  lines: string[];
  fallbackUsed: boolean;
}

export interface VoiceoverRequest {
  prompt: string;
  /** The scenes as planned, so what is said matches what is shown. */
  scenes: string[];
  config: CompilerProfileConfig;
  provider: TextAdapter | undefined;
  budgetMs?: number;
  log?: Logger;
}

function parseLines(text: string, count: number): string[] | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  const lines = (parsed as { lines?: unknown }).lines;
  if (!Array.isArray(lines)) return undefined;
  const usable = lines.filter(
    (line): line is string => typeof line === 'string' && line.trim().length > 0,
  );
  return usable.length >= count ? usable.slice(0, count).map((line) => line.trim()) : undefined;
}

/**
 * A line per scene, or nothing at all. There is no deterministic fallback here on purpose: a
 * made up voiceover would put words in the creator's mouth, and a silent reel is honest. The
 * scenes and the render carry on either way.
 */
export async function planVoiceover(request: VoiceoverRequest): Promise<VoiceoverPlan> {
  const config = request.config.voiceover;
  if (!config || !request.provider || request.scenes.length === 0) {
    return { lines: [], fallbackUsed: true };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), request.budgetMs ?? VOICEOVER_BUDGET_MS);
  try {
    const scenes = request.scenes.map((scene, i) => `Scene ${i + 1}: ${scene}`).join('\n\n');
    const result = await request.provider.generate({
      prompt: `${request.prompt}\n\n${scenes}\n\nWrite one spoken line for each of the ${request.scenes.length} scenes.`,
      system: config.system,
      maxOutputTokens: config.maxOutputTokens,
      format: 'json',
      signal: controller.signal,
    });
    const lines = parseLines(result.text, request.scenes.length);
    if (!lines) {
      request.log?.warn({ provider: request.provider.key }, 'voiceover was not usable');
      return { lines: [], fallbackUsed: true };
    }
    return { lines, fallbackUsed: false };
  } catch (err) {
    request.log?.warn({ err, provider: request.provider.key }, 'voiceover planner failed');
    return { lines: [], fallbackUsed: true };
  } finally {
    clearTimeout(timer);
  }
}
