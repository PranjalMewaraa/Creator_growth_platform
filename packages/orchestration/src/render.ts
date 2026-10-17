import {
  REQUIREMENTS_HEADING,
  type CompilerProfileConfig,
  type ResolvedSetting,
  type SettingValue,
} from '@cgp/contracts';

// Longest brief kept, whether written by the model or by the user. 2000 was sized for a single
// prose paragraph; the image/thumbnail/video rewrite (WP57) now asks for up to eight labelled
// sections, which a 180–320 word reply can run past at normal prose density, so the ceiling
// grew with it rather than letting the style/section instructions get silently truncated mid
// section on an ordinary reply.
export const MAX_BRIEF_CHARS = 3000;

const PLACEHOLDER = /\{\{(\w+)\}\}/g;

function show(value: SettingValue | undefined): string {
  if (value === undefined || value === false) return '';
  if (value === true) return '';
  if (Array.isArray(value)) return value.join(', ');
  return String(value);
}

function present(value: SettingValue | undefined): boolean {
  if (value === undefined || value === false || value === '') return false;
  return !(Array.isArray(value) && value.length === 0);
}

/**
 * Fills `{{name}}` placeholders. A line whose placeholders are all empty is dropped, so a
 * workspace with no pillars gets no "Content pillars:" line.
 */
export function fill(template: string, values: Record<string, SettingValue | undefined>): string {
  return template
    .split('\n')
    .flatMap((line) => {
      const names = [...line.matchAll(PLACEHOLDER)].map((m) => m[1] ?? '');
      if (names.length > 0 && names.every((name) => !present(values[name]))) return [];
      return [line.replace(PLACEHOLDER, (_, name: string) => show(values[name]))];
    })
    .join('\n');
}

export function valuesOf(settings: ResolvedSetting[]): Record<string, SettingValue> {
  return Object.fromEntries(settings.map((s) => [s.key, s.value]));
}

/** Stage 1: the deterministic brief. Also the fallback when stage 2 breaches or fails. */
export function assembleBrief(
  config: CompilerProfileConfig,
  intentText: string,
  settings: ResolvedSetting[],
): string {
  return fill(config.brief, { ...valuesOf(settings), intent: intentText }).trim();
}

/** The brief part of a prompt: everything before the requirements heading. */
export function briefOf(text: string): string {
  const at = text.search(new RegExp(`^${REQUIREMENTS_HEADING}\\s*$`, 'm'));
  return (at === -1 ? text : text.slice(0, at)).trim();
}

/**
 * Stage 3: deterministic enforcement. Whatever the brief says, from the model or from a user
 * edit, the requirements are rebuilt from the resolved settings and appended, so no rewrite
 * or edit can drop a platform constraint or the safety policy.
 */
export function enforce(
  brief: string,
  config: CompilerProfileConfig,
  settings: ResolvedSetting[],
): string {
  const body = briefOf(brief).slice(0, MAX_BRIEF_CHARS).trim();
  const values = valuesOf(settings);
  const lines = config.requirements
    .filter(({ key }) => present(values[key]))
    .map(({ line }) => fill(line, values).trim())
    .filter((line) => line.length > 0);
  if (lines.length === 0) return body;
  return `${body}\n\n${REQUIREMENTS_HEADING}\n${lines.map((line) => `- ${line}`).join('\n')}`;
}
