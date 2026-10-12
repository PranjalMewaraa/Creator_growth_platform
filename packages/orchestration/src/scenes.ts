import type { Logger } from '@cgp/config';
import type { CompilerProfileConfig, TextAdapter } from '@cgp/contracts';
import { fill } from './render';

/**
 * Breaking a compiled prompt into scenes (WP22). This is the engine's work, not the
 * generator's (invariant 4): the video generator asks for scenes and is handed them, and what
 * a scene may say comes from the versioned compiler profile, not from code.
 *
 * Like the rewrite pass, the planner can only improve the result: if the model is slow, wrong
 * or unreachable, the deterministic fallback from the profile is used and the render carries
 * on. A reel of identical shots is worse than a planned one and better than no reel.
 */

/** Long enough for a planner that is not on a user's critical path; a render takes minutes. */
export const SCENE_PLAN_BUDGET_MS = 20_000;

export interface ScenePlan {
  scenes: string[];
  /** True when the planner did not answer and the profile's fallback was used. */
  fallbackUsed: boolean;
}

export interface ScenePlanRequest {
  /** The compiled prompt, exactly as persisted. */
  prompt: string;
  config: CompilerProfileConfig;
  sceneCount: number;
  provider: TextAdapter | undefined;
  budgetMs?: number;
  log?: Logger;
}

function fallbackScenes(request: ScenePlanRequest): string[] {
  const line = request.config.scenes?.fallback ?? 'Scene {{n}} of {{of}}.';
  return Array.from({ length: request.sceneCount }, (_, i) =>
    // The whole prompt, plus which scene this is: every shot is the brief, which is dull but
    // never wrong.
    `${request.prompt}\n\n${fill(line, { n: i + 1, of: request.sceneCount })}`.trim(),
  );
}

function parseScenes(text: string, sceneCount: number): string[] | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  const scenes = (parsed as { scenes?: unknown }).scenes;
  if (!Array.isArray(scenes)) return undefined;
  const usable = scenes.filter(
    (scene): scene is string => typeof scene === 'string' && !!scene.trim(),
  );
  // Too few scenes would silently shorten the reel the creator paid for.
  return usable.length >= sceneCount ? usable.slice(0, sceneCount) : undefined;
}

/** One scene description per scene, in order. Never throws: a plan always comes back. */
export async function planScenes(request: ScenePlanRequest): Promise<ScenePlan> {
  const config = request.config.scenes;
  if (!config || !request.provider) {
    return { scenes: fallbackScenes(request), fallbackUsed: true };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), request.budgetMs ?? SCENE_PLAN_BUDGET_MS);
  try {
    const result = await request.provider.generate({
      prompt: `${request.prompt}\n\nBreak this into exactly ${request.sceneCount} scenes.`,
      system: config.system,
      maxOutputTokens: config.maxOutputTokens,
      format: 'json',
      schema: {
        type: 'object',
        properties: {
          scenes: {
            type: 'array',
            items: { type: 'string' },
            minItems: request.sceneCount,
            maxItems: request.sceneCount,
          },
        },
        required: ['scenes'],
      },
      signal: controller.signal,
    });
    const scenes = parseScenes(result.text, request.sceneCount);
    if (!scenes) {
      request.log?.warn({ provider: request.provider.key }, 'scene plan was not usable');
      return { scenes: fallbackScenes(request), fallbackUsed: true };
    }
    return { scenes, fallbackUsed: false };
  } catch (err) {
    request.log?.warn({ err, provider: request.provider.key }, 'scene planner failed');
    return { scenes: fallbackScenes(request), fallbackUsed: true };
  } finally {
    clearTimeout(timer);
  }
}
