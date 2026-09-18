import { LANGUAGES, type LanguageCode } from '@cgp/contracts';

/**
 * The routing seam (plan section 3): the language decides which compiler profiles compile a
 * request. English is the only route for the demo. Adding Hindi means adding `hi` to
 * LANGUAGES, a route here and `*.hi` compiler profile rows, with no change to the engine.
 */
export interface LanguageRoute {
  language: LanguageCode;
  /** How the requirements name the language to the model. */
  displayName: string;
  compilerProfileKey(base: string): string;
}

const ROUTES: Record<LanguageCode, LanguageRoute> = {
  en: { language: 'en', displayName: 'English', compilerProfileKey: (base) => `${base}.en` },
};

export const DEFAULT_LANGUAGE: LanguageCode = 'en';

function isLanguage(value: string): value is LanguageCode {
  return (LANGUAGES as readonly string[]).includes(value);
}

/** The route for a workspace's language, or the default when that language has no route yet. */
export function routeLanguage(requested: string | null | undefined): LanguageRoute {
  return ROUTES[requested && isLanguage(requested) ? requested : DEFAULT_LANGUAGE];
}
