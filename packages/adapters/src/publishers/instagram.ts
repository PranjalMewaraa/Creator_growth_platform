import type { Logger } from '@cgp/config';
import { AdapterError, type FailureCategory, type Publisher } from '@cgp/contracts';
import { normalizeError } from '../errors';

// Instagram Login API (docs/spikes/instagram.md): create a container from a public image URL,
// wait for it to finish, then media_publish. Only media_publish makes anything public.

const API = 'https://graph.instagram.com';

interface GraphError {
  message?: string;
  error_user_msg?: string;
  code?: number;
  error_subcode?: number;
}

/** Graph error codes to what a caller should do (plan section 14). */
function categoryFor(status: number, error: GraphError): FailureCategory {
  if (error.code === 190 || status === 401) return 'reauth';
  if ([4, 9, 17, 32, 613].includes(error.code ?? 0) || status === 429) return 'quota';
  if (error.error_subcode === 2207042) return 'quota'; // publishing limit for the day
  if ([1, 2].includes(error.code ?? 0) || status >= 500) return 'retriable';
  return 'terminal';
}

export interface InstagramPublisherOptions {
  log?: Logger;
  fetch?: typeof fetch;
}

export function createInstagramPublisher(options: InstagramPublisherOptions = {}): Publisher {
  const doFetch = options.fetch ?? fetch;

  async function graph<T>(
    token: string,
    path: string,
    {
      method = 'GET',
      params = {},
    }: { method?: 'GET' | 'POST'; params?: Record<string, string> } = {},
  ): Promise<T> {
    const query = new URLSearchParams({ ...params, access_token: token });
    let response: Response;
    try {
      response = await doFetch(
        method === 'GET' ? `${API}${path}?${query.toString()}` : `${API}${path}`,
        method === 'POST'
          ? {
              method,
              headers: { 'content-type': 'application/x-www-form-urlencoded' },
              body: query,
            }
          : undefined,
      );
    } catch (err) {
      // No answer at all: the URL carries the token, so only the normalised error goes on.
      throw normalizeError('instagram', err, options.log);
    }
    const body = (await response.json().catch(() => ({}))) as T & { error?: GraphError };
    if (!response.ok || body.error) {
      const error = body.error ?? {};
      // Platform messages are shown verbatim in the sync centre (WP35); they never hold tokens.
      throw new AdapterError({
        code: `HTTP_${response.status}`,
        message:
          error.error_user_msg ?? error.message ?? `Instagram answered HTTP ${response.status}`,
        category: categoryFor(response.status, error),
      });
    }
    return body;
  }

  return {
    platform: 'instagram',

    async prepare(account, content) {
      const media = content.media;
      if (media?.kind !== 'image' || !/jpe?g/.test(media.mimeType)) {
        throw new AdapterError({
          code: 'MEDIA_REQUIRED',
          message: 'Instagram posts need a JPEG image',
          category: 'terminal',
        });
      }
      const container = await graph<{ id: string }>(
        account.accessToken,
        `/${account.externalId}/media`,
        {
          method: 'POST',
          params: { image_url: media.url, caption: content.text },
        },
      );
      return { platform: 'instagram', ref: container.id };
    },

    async check(account, prepared) {
      const container = await graph<{ status_code?: string; status?: string }>(
        account.accessToken,
        `/${prepared.ref}`,
        { params: { fields: 'status_code,status' } },
      );
      switch (container.status_code) {
        case 'FINISHED':
          return { state: 'ready' };
        case 'IN_PROGRESS':
          return { state: 'processing' };
        default:
          return {
            state: 'failed',
            error: {
              code: `CONTAINER_${container.status_code ?? 'UNKNOWN'}`,
              message: container.status ?? 'Instagram could not process the media',
              category: container.status_code === 'EXPIRED' ? 'retriable' : 'terminal',
            },
          };
      }
    },

    async publish(account, prepared) {
      const published = await graph<{ id: string }>(
        account.accessToken,
        `/${account.externalId}/media_publish`,
        { method: 'POST', params: { creation_id: prepared.ref } },
      );
      // The post is public now. Nothing after this line may throw, or a retry could post twice.
      const permalink = await graph<{ permalink?: string }>(
        account.accessToken,
        `/${published.id}`,
        {
          params: { fields: 'permalink' },
        },
      )
        .then((media) => media.permalink)
        .catch(() => undefined);
      return { platformPostId: published.id, ...(permalink ? { permalink } : {}) };
    },

    metrics() {
      // Insights come in week 7; until then nothing is reported rather than anything invented.
      return Promise.resolve({ fetchedAt: new Date().toISOString() });
    },
  };
}
