import type { ProfileInput } from '@cgp/core';

/**
 * What each answer puts into every compiled prompt, worded as the compiler words it (compiler
 * profiles v2 and the stage 3 requirements), so onboarding shows its effect as it happens.
 * Keys match the profile fields, so the answer being edited can be highlighted. Platforms and
 * cadence are not prompt text: they decide where posts go and how the calendar is planned.
 */
export function briefLines(profile: ProfileInput): Array<{ key: string; text: string | null }> {
  const creator = [
    profile.teamShape,
    profile.contentTypes.length > 0 ? `making ${profile.contentTypes.join(' and ')}` : '',
  ]
    .filter(Boolean)
    .join(', ');
  return [
    { key: 'teamShape', text: creator ? `Who is posting: ${creator}.` : null },
    {
      key: 'pillars',
      text: profile.pillars.length ? `Content pillars: ${profile.pillars.join(', ')}.` : null,
    },
    { key: 'goal90d', text: profile.goal90d ? `Current goal: ${profile.goal90d}.` : null },
    { key: 'tone', text: profile.tone ? `Tone: ${profile.tone}.` : null },
    {
      key: 'prohibitedWords',
      text: profile.prohibitedWords.length
        ? `Never use these words: ${profile.prohibitedWords.join(', ')}.`
        : null,
    },
    { key: 'language', text: 'Write in English.' },
  ];
}
