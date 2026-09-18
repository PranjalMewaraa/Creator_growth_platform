import type { Logger } from '@cgp/config';
import type {
  MediaBytes,
  ModerationAdapter,
  ModerationCategory,
  ModerationVerdict,
} from '@cgp/contracts';
import { GoogleAuth } from 'google-auth-library';
import { normalizeError } from '../errors';

// D3: Cloud Natural Language moderateText for text, Vision SafeSearch for images. Both bill
// the GCP project, so both draw on the trial credit.

/**
 * Natural Language categories we act on, and what the user is told. The rest (Health,
 * Religion & Belief, Politics, Finance, Legal, War & Conflict) mark sensitive topics rather than
 * harmful content, so they never block.
 */
const TEXT_CATEGORIES: Record<string, ModerationCategory> = {
  Sexual: 'sexual',
  Violent: 'violence',
  'Death, Harm & Tragedy': 'violence',
  Derogatory: 'hate',
  Insult: 'harassment',
  Toxic: 'harassment',
  'Firearms & Weapons': 'dangerous',
  'Public Safety': 'dangerous',
  'Illicit Drugs': 'illicit',
};

/** Confidence at or above which a category blocks. Tuned against the eval set in week 4. */
export const TEXT_BLOCK_THRESHOLD = 0.8;

const LIKELIHOOD = ['UNKNOWN', 'VERY_UNLIKELY', 'UNLIKELY', 'POSSIBLE', 'LIKELY', 'VERY_LIKELY'];

/** SafeSearch fields we act on, with the likelihood that blocks. */
const IMAGE_RULES: Array<{ field: string; category: ModerationCategory; blockAt: string }> = [
  { field: 'adult', category: 'sexual', blockAt: 'LIKELY' },
  { field: 'violence', category: 'violence', blockAt: 'LIKELY' },
  { field: 'racy', category: 'sexual', blockAt: 'VERY_LIKELY' },
];

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly headers: Headers,
  ) {
    super(`HTTP ${status}`);
  }
}

interface ModerateTextResponse {
  moderationCategories?: Array<{ name?: string; confidence?: number }>;
}

interface AnnotateResponse {
  responses?: Array<{
    safeSearchAnnotation?: Record<string, string | undefined>;
    error?: { code?: number; message?: string };
  }>;
}

export interface GoogleModerationOptions {
  project: string;
  log?: Logger;
  /** Tests pass a fetch that never leaves the machine, and auth headers that need no login. */
  fetch?: typeof fetch;
  authHeaders?: (url: string) => Promise<ConstructorParameters<typeof Headers>[0]>;
}

/** One entry per category, at its highest score, highest first. */
function verdict(flagged: ModerationVerdict['flagged']): ModerationVerdict {
  const best = new Map<ModerationCategory, number>();
  for (const { category, score } of flagged) {
    best.set(category, Math.max(score, best.get(category) ?? 0));
  }
  const sorted = [...best.entries()]
    .map(([category, score]) => ({ category, score }))
    .sort((a, b) => b.score - a.score);
  return { allowed: sorted.length === 0, flagged: sorted };
}

export function createGoogleModeration(options: GoogleModerationOptions): ModerationAdapter {
  const doFetch = options.fetch ?? fetch;
  const authHeaders =
    options.authHeaders ??
    (() => {
      const auth = new GoogleAuth({ scopes: 'https://www.googleapis.com/auth/cloud-platform' });
      return async (url: string) => (await auth.getClient()).getRequestHeaders(url);
    })();

  async function post<T>(url: string, body: unknown): Promise<T> {
    const headers = new Headers(await authHeaders(url));
    headers.set('content-type', 'application/json');
    // User credentials need the project named for quota and billing.
    headers.set('x-goog-user-project', options.project);
    const response = await doFetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
    if (!response.ok) throw new HttpError(response.status, response.headers);
    return (await response.json()) as T;
  }

  return {
    key: 'google-moderation',

    async checkText(text) {
      try {
        const body = await post<ModerateTextResponse>(
          'https://language.googleapis.com/v2/documents:moderateText',
          { document: { type: 'PLAIN_TEXT', content: text } },
        );
        return verdict(
          (body.moderationCategories ?? []).flatMap(({ name, confidence }) => {
            const category = name ? TEXT_CATEGORIES[name] : undefined;
            return category && (confidence ?? 0) >= TEXT_BLOCK_THRESHOLD
              ? [{ category, score: confidence ?? 0 }]
              : [];
          }),
        );
      } catch (err) {
        throw normalizeError('moderation', err, options.log);
      }
    },

    async checkImage(image: MediaBytes) {
      try {
        const body = await post<AnnotateResponse>(
          'https://vision.googleapis.com/v1/images:annotate',
          {
            requests: [
              {
                image: { content: Buffer.from(image.data).toString('base64') },
                features: [{ type: 'SAFE_SEARCH_DETECTION' }],
              },
            ],
          },
        );
        const result = body.responses?.[0];
        if (result?.error) throw new HttpError(result.error.code ?? 500, new Headers());
        const annotation = result?.safeSearchAnnotation ?? {};
        return verdict(
          IMAGE_RULES.flatMap(({ field, category, blockAt }) => {
            const level = LIKELIHOOD.indexOf(annotation[field] ?? 'UNKNOWN');
            return level >= LIKELIHOOD.indexOf(blockAt)
              ? [{ category, score: level / (LIKELIHOOD.length - 1) }]
              : [];
          }),
        );
      } catch (err) {
        throw normalizeError('moderation', err, options.log);
      }
    },
  };
}
