import {
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
