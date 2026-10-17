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

/** Veo's only clip length (invariant: packages/core SECONDS_PER_SCENE). Not imported, since
 *  orchestration does not depend on core; kept equal by the comment on each side. */
const SECONDS_PER_SCENE = 8;

export interface ScenePlan {
  scenes: string[];
  /** True when the planner did not answer and the profile's fallback was used. */
  fallbackUsed: boolean;
}

export interface ScenePlanRequest {
  /** The compiled prompt, exactly as persisted. */
  prompt: string;
  config: CompilerProfileConfig;
  /**
   * How long the piece should run (WP59). Scenes are still atomically eight seconds each —
   * Veo's own fixed clip length — but the count of them is no longer picked by the creator: a
   * free-flowing sequence (a quick fight, say) wants more, shorter beats than a calm one wants
   * at the same length, so the planner chooses how many beats best fill the target, not a
   * number handed down in advance.
   */
  targetDurationSeconds: number;
  /**
   * A storyboard is charged a flat credit price up front, held for exactly the frames it asks
   * for and settled for that same number whatever actually draws (`storyboard.ts`), so its
   * plan has to land on the one count the hold was sized for. The committed video is settled
   * on the seconds actually delivered instead, so it alone can let the planner roam a beat
   * either side of the target. Defaults to roaming; a storyboard passes `false`.
   */
  flexible?: boolean;
  provider: TextAdapter | undefined;
  budgetMs?: number;
  log?: Logger;
}

/** The planner's room to roam: exactly the target's worth of beats when the caller is holding
 *  a flat price against that count, or — for a reel settled on what actually renders — never
 *  fewer than one beat and one more than the target allows for a sequence that wants a quick
 *  final cut, bounded so the 1-a-minute render queue stays a reasonable wait. */
function sceneBounds(targetDurationSeconds: number, flexible: boolean): { min: number; max: number } {
  const target = Math.max(1, Math.round(targetDurationSeconds / SECONDS_PER_SCENE));
  return flexible ? { min: 1, max: target + 1 } : { min: target, max: target };
}

function fallbackScenes(request: ScenePlanRequest): string[] {
  const line = request.config.scenes?.fallback ?? 'Scene {{n}} of {{of}}.';
  // No LLM to ask how to break it up, so the deterministic fallback takes the plain reading of
  // the target: the number of eight-second beats that add up to it.
  const count = Math.max(1, Math.round(request.targetDurationSeconds / SECONDS_PER_SCENE));
  return Array.from({ length: count }, (_, i) =>
    // The whole prompt, plus which scene this is: every shot is the brief, which is dull but
    // never wrong.
    `${request.prompt}\n\n${fill(line, { n: i + 1, of: count })}`.trim(),
  );
}

function parseScenes(text: string, minScenes: number, maxScenes: number): string[] | undefined {
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
  // Fewer than the floor would silently shorten what the hold was sized for; more than the
  // ceiling is simply cut, since that ceiling is what the render queue was sized for too.
  return usable.length >= minScenes ? usable.slice(0, maxScenes) : undefined;
}

/** One scene description per scene, in order. Never throws: a plan always comes back. */
export async function planScenes(request: ScenePlanRequest): Promise<ScenePlan> {
  const config = request.config.scenes;
  if (!config || !request.provider) {
    return { scenes: fallbackScenes(request), fallbackUsed: true };
  }

  const flexible = request.flexible ?? true;
  const { min, max } = sceneBounds(request.targetDurationSeconds, flexible);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), request.budgetMs ?? SCENE_PLAN_BUDGET_MS);
  try {
    const result = await request.provider.generate({
      prompt: flexible
        ? `${request.prompt}\n\nBreak this into however many continuous eight-second beats, ` +
          `from ${min} to ${max}, best tell it as one free-flowing sequence totalling close to ` +
          `${request.targetDurationSeconds} seconds: fewer, longer-held beats for something ` +
          'calm, more, quicker beats for something fast like a clash or a chase.'
        : `${request.prompt}\n\nBreak this into exactly ${min} scenes.`,
      system: config.system,
      maxOutputTokens: config.maxOutputTokens,
      format: 'json',
      schema: {
        type: 'object',
        properties: {
          scenes: {
            type: 'array',
            items: { type: 'string' },
            minItems: min,
            maxItems: max,
          },
        },
        required: ['scenes'],
      },
      signal: controller.signal,
    });
    const scenes = parseScenes(result.text, min, max);
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
