import type { CompiledPrompt, OutputType } from './generator';
import type { LanguageCode } from './media';

/**
 * Where a setting came from, highest precedence first (FR-PO-06, plan section 5). Resolved in
 * code, never delegated to the model: a higher source always wins a key a lower one also sets.
 * The brand kit counts as a workspace default, alongside the profile.
 */
export const PRECEDENCE = ['safety', 'platform', 'user', 'template', 'profile'] as const;

export type PrecedenceSource = (typeof PRECEDENCE)[number];

export type SettingValue = string | number | boolean | string[];

/** One source's value for one setting, before resolution. */
export interface Directive {
  key: string;
  value: SettingValue;
  source: PrecedenceSource;
}

/** The value that won, and what it beat, so the disclosure can say why. */
export interface ResolvedSetting {
  key: string;
  value: SettingValue;
  source: PrecedenceSource;
  overridden: Array<{ source: PrecedenceSource; value: SettingValue }>;
}

/**
 * A compiler profile's config, stored as a versioned row (changeable without a deploy).
 * Placeholders are `{{setting}}`; a line whose placeholders are all empty is dropped.
 */
export interface CompilerProfileConfig {
  /** Stage 1: the brief, assembled from resolved settings. */
  brief: string;
  /** Stage 3: one line per setting, appended under the requirements heading in this order. */
  requirements: Array<{ key: string; line: string }>;
  /** Stage 2: the rewrite pass. */
  rewrite: { system: string; maxOutputTokens: number };
  /** A text generator's own call: the compiled prompt is its user message. Absent for media. */
  generation?: {
    system: string;
    maxOutputTokens: number;
    temperature?: number;
    format?: 'text' | 'json';
  };
  /**
   * How a compiled prompt is broken into scenes, for the output types that have them. The
   * engine owns this, not the generator (invariant 4), and it is versioned config like the
   * rest: a fallback line is used when the model cannot be reached in time.
   */
  scenes?: {
    system: string;
    maxOutputTokens: number;
    /** Deterministic scene text when the planner fails. `{{n}}` and `{{of}}` are filled. */
    fallback: string;
  };
  /** Settings this output type always has, at template precedence. */
  defaults?: Record<string, SettingValue>;
}

/** The heading that separates the brief from the enforced requirements. */
export const REQUIREMENTS_HEADING = 'Requirements:';

/** A compiled prompt as the disclosure shows it: the artifact plus how it was resolved. */
export interface CompiledPromptView extends CompiledPrompt {
  outputType: OutputType;
  parentId: string | null;
  language: LanguageCode;
  settings: ResolvedSetting[];
  createdAt: string;
}
