import {
  TARGET_PLATFORMS,
  type CompilerProfileConfig,
  type Directive,
  type OutputType,
  type SettingValue,
  type TargetPlatform,
} from '@cgp/contracts';
import type { brandKits, templateVersions, workspaceProfiles } from '@cgp/db';
import type { LanguageRoute } from './language';
import { PLATFORM_NAMES, platformDirectives, safetyDirectives } from './policy';

export interface DirectiveSources {
  outputType: OutputType;
  targetPlatform: TargetPlatform | null;
  /** Explicit user instructions: every generator input field except intent, template, target. */
  params: Record<string, unknown>;
  template: Pick<typeof templateVersions.$inferSelect, 'aspectRatio' | 'styleParams'>;
  config: CompilerProfileConfig;
  profile: typeof workspaceProfiles.$inferSelect;
  brandKit: typeof brandKits.$inferSelect;
  language: LanguageRoute;
}

function isSettingValue(value: unknown): value is SettingValue {
  if (Array.isArray(value)) return value.every((v) => typeof v === 'string');
  return ['string', 'number', 'boolean'].includes(typeof value);
}

function entries(
  source: Directive['source'],
  values: Record<string, unknown> | null | undefined,
): Directive[] {
  return Object.entries(values ?? {}).flatMap(([key, value]) =>
    isSettingValue(value) && value !== '' ? [{ key, value, source }] : [],
  );
}

function optional(key: string, value: SettingValue | null | undefined): Directive[] {
  if (value === null || value === undefined || value === '') return [];
  if (Array.isArray(value) && value.length === 0) return [];
  return [{ key, value, source: 'profile' }];
}

/** Every source's say on every setting, before precedence is applied. */
export function collectDirectives(sources: DirectiveSources): Directive[] {
  const { outputType, targetPlatform, params, template, config, profile, brandKit } = sources;
  const asked = Array.isArray(params.platforms)
    ? params.platforms.filter((p): p is TargetPlatform => p === 'instagram' || p === 'linkedin')
    : [];
  // A caption set covers the platforms asked for, else the target, else every platform.
  const captionPlatforms: TargetPlatform[] =
    asked.length > 0 ? asked : targetPlatform ? [targetPlatform] : [...TARGET_PLATFORMS];

  const platformName = targetPlatform
    ? PLATFORM_NAMES[targetPlatform]
    : captionPlatforms.map((p) => PLATFORM_NAMES[p]).join(' and ') || 'social media';

  const user: Directive[] = [
    { key: 'platform', value: platformName, source: 'user' },
    ...entries('user', params).filter((d) => d.key !== 'platforms'),
    ...(outputType === 'caption'
      ? [
          {
            key: 'platforms',
            value: captionPlatforms.map((p) => PLATFORM_NAMES[p]),
            source: asked.length > 0 ? ('user' as const) : ('template' as const),
          },
        ]
      : []),
  ];

  const templateDefaults: Directive[] = [
    // The template's own params come first: same precedence as the output type's defaults, and
    // the resolver keeps the first of equals, so a template beats the generic default it sets.
    ...entries('template', template.styleParams as Record<string, unknown>),
    ...entries('template', config.defaults),
    ...(template.aspectRatio !== 'none'
      ? [{ key: 'aspectRatio', value: template.aspectRatio, source: 'template' as const }]
      : []),
  ];

  const creator = [
    profile.teamShape,
    profile.contentTypes.length > 0 ? `making ${profile.contentTypes.join(' and ')}` : '',
  ]
    .filter(Boolean)
    .join(', ');
  const workspaceDefaults: Directive[] = [
    { key: 'language', value: sources.language.displayName, source: 'profile' },
    ...optional('tone', profile.tone),
    ...optional('creator', creator),
    ...optional('pillars', profile.pillars),
    ...optional('goal', profile.goal90d),
    ...optional('prohibitedWords', profile.prohibitedWords),
    ...optional('tagline', brandKit.tagline),
    ...optional('brandColours', brandKit.colors),
    ...optional('typography', brandKit.typography),
  ];

  return [
    ...safetyDirectives(outputType),
    ...platformDirectives(outputType, targetPlatform, captionPlatforms),
    ...user,
    ...templateDefaults,
    ...workspaceDefaults,
  ];
}
