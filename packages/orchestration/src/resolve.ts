import {
  composeLook,
  LOOK_KEYS,
  PRECEDENCE,
  type Directive,
  type ResolvedSetting,
  type SettingValue,
} from '@cgp/contracts';

const RANK = new Map(PRECEDENCE.map((source, i) => [source, i]));

/**
 * FR-PO-06, in code: for each key the highest source wins, and what it beat is kept so the
 * disclosure can show why. Keys come out in first seen order, so the result is deterministic.
 */
export function resolveSettings(directives: Directive[]): ResolvedSetting[] {
  const byKey = new Map<string, Directive[]>();
  for (const directive of directives) {
    const list = byKey.get(directive.key) ?? [];
    list.push(directive);
    byKey.set(directive.key, list);
  }
  return [...byKey.entries()].map(([key, list]) => {
    const [winner, ...rest] = [...list].sort(
      (a, b) => (RANK.get(a.source) ?? 99) - (RANK.get(b.source) ?? 99),
    );
    if (!winner) throw new Error(`No directive for ${key}`);
    return {
      key,
      value: winner.value,
      source: winner.source,
      overridden: rest.map(({ source, value }) => ({ source, value })),
    };
  });
}

export function settingValue(settings: ResolvedSetting[], key: string): SettingValue | undefined {
  return settings.find((s) => s.key === key)?.value;
}

/** Spoken English runs at about 2.5 words a second; the script gets that as a word budget. */
const WORDS_PER_SECOND = 2.5;

/** Settings computed from others. They take the source of the setting they came from. */
export function deriveSettings(settings: ResolvedSetting[]): ResolvedSetting[] {
  return deriveLook(deriveWordBudget(settings));
}

function deriveWordBudget(settings: ResolvedSetting[]): ResolvedSetting[] {
  const duration = settings.find((s) => s.key === 'durationSeconds');
  if (!duration || typeof duration.value !== 'number') return settings;
  return [
    ...settings.filter((s) => s.key !== 'wordBudget'),
    {
      key: 'wordBudget',
      value: Math.round(duration.value * WORDS_PER_SECOND),
      source: duration.source,
      overridden: [],
    },
  ];
}

/**
 * The look (WP37), composed from whichever of camera, lens, focal length and aperture won
 * their own precedence. Derived rather than asked for directly, so a template can set a
 * house look and a creator can override one part of it without restating the rest, and the
 * disclosure shows each part's source as it shows every other setting's.
 */
function deriveLook(settings: ResolvedSetting[]): ResolvedSetting[] {
  const parts = LOOK_KEYS.map((key) => settings.find((s) => s.key === key)).filter(
    (setting): setting is ResolvedSetting => setting !== undefined,
  );
  if (parts.length === 0) return settings;

  const look = composeLook(
    Object.fromEntries(
      parts.map((setting) => [setting.key, typeof setting.value === 'string' ? setting.value : '']),
    ),
  );
  if (!look) return settings;
  return [
    ...settings.filter((s) => s.key !== 'look'),
    // The source of the part that was most specific about it: a look a creator asked for
    // reads as theirs, one a template supplied reads as the template's.
    { key: 'look', value: look, source: strongest(parts).source, overridden: [] },
  ];
}

function strongest(settings: ResolvedSetting[]): ResolvedSetting {
  const [first] = [...settings].sort(
    (a, b) => (RANK.get(a.source) ?? 99) - (RANK.get(b.source) ?? 99),
  );
  if (!first) throw new Error('No setting to take a source from');
  return first;
}
