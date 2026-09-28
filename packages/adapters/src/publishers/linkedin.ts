import type { Logger } from '@cgp/config';
import { AdapterError, type FailureCategory, type Publisher } from '@cgp/contracts';
import { categoryForStatus, normalizeError } from '../errors';

// LinkedIn Posts API for a member (docs/spikes/linkedin.md): register an image upload, PUT the
// bytes, wait until AVAILABLE, then create the post. Only creating the post makes it public.

const API = 'https://api.linkedin.com';
/** An active monthly release of the versioned REST API; they retire after about a year. */
export const LINKEDIN_VERSION = '202608';

const TEXT_ONLY = 'text-only';

/** Member tokens: a 401 or 403 means the member must reconnect, not that we are misconfigured. */
function categoryFor(status: number): FailureCategory {
  return status === 401 || status === 403 ? 'reauth' : categoryForStatus(status);
}

/**
 * LinkedIn's "little" text format treats these as markup; unescaped, the text is cut short or
 * rejected. Hashtags become LinkedIn hashtag entities so they stay clickable.
 */
export function toLittleText(text: string): string {
  const parts = text.split(/(#[\p{L}\p{N}_]+)/u);
  return parts
    .map((part, i) =>
      i % 2 === 1
        ? `{hashtag|\\#|${part.slice(1).replace(/[\\|{}@[\]()<>#*_~]/g, '\\$&')}}`
        : part.replace(/[\\|{}@[\]()<>#*_~]/g, '\\$&'),
    )
    .join('');
}

export interface LinkedInPublisherOptions {
  log?: Logger;
  fetch?: typeof fetch;
}

export function createLinkedInPublisher(options: LinkedInPublisherOptions = {}): Publisher {
  const doFetch = options.fetch ?? fetch;

  async function call(
    token: string,
    method: string,
    url: string,
    { body, rest = true }: { body?: unknown; rest?: boolean } = {},
  ): Promise<Response> {
    const headers: Record<string, string> = { authorization: `Bearer ${token}` };
    if (rest) {
      headers['LinkedIn-Version'] = LINKEDIN_VERSION;
      headers['X-Restli-Protocol-Version'] = '2.0.0';
    }
    if (body !== undefined) headers['content-type'] = 'application/json';
    let response: Response;
    try {
      response = await doFetch(url.startsWith('http') ? url : `${API}${url}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (err) {
      throw normalizeError('linkedin', err, options.log);
    }
    if (!response.ok) {
      const detail = (await response.json().catch(() => ({}))) as { message?: string };
      throw new AdapterError({
        code: `HTTP_${response.status}`,
        message: detail.message ?? `LinkedIn answered HTTP ${response.status}`,
        category: categoryFor(response.status),
      });
    }
    return response;
  }

  const author = (externalId: string) => `urn:li:person:${externalId}`;

  return {
    platform: 'linkedin',

    async prepare(account, content) {
      if (!content.media) return { platform: 'linkedin', ref: TEXT_ONLY };
      if (content.media.kind !== 'image') {
        throw new AdapterError({
          code: 'MEDIA_UNSUPPORTED',
          message: 'Only image posts are supported on LinkedIn so far',
          category: 'terminal',
        });
      }
      const media = await doFetch(content.media.url).catch((err: unknown) => {
        throw normalizeError('storage', err, options.log);
      });
      if (!media.ok) {
        throw new AdapterError({
          code: `MEDIA_HTTP_${media.status}`,
          message: 'Could not read the image to upload',
          category: categoryForStatus(media.status),
        });
      }
      const bytes = new Uint8Array(await media.arrayBuffer());

      const init = (await (
        await call(account.accessToken, 'POST', '/rest/images?action=initializeUpload', {
          body: { initializeUploadRequest: { owner: author(account.externalId) } },
        })
      ).json()) as { value: { uploadUrl: string; image: string } };
      // Nothing is public until a post references the image, so this is safe to repeat.
      await doFetch(init.value.uploadUrl, {
        method: 'PUT',
        headers: { authorization: `Bearer ${account.accessToken}` },
        body: bytes,
      }).then((put) => {
        if (!put.ok) {
          throw new AdapterError({
            code: `HTTP_${put.status}`,
            message: 'LinkedIn refused the image upload',
            category: categoryFor(put.status),
          });
        }
      });
      return { platform: 'linkedin', ref: init.value.image };
    },

    async check(account, prepared) {
      if (prepared.ref === TEXT_ONLY) return { state: 'ready' };
      const image = (await (
        await call(account.accessToken, 'GET', `/rest/images/${encodeURIComponent(prepared.ref)}`)
      ).json()) as { status?: string };
      if (image.status === 'AVAILABLE') return { state: 'ready' };
      if (image.status === 'PROCESSING' || image.status === 'WAITING_UPLOAD') {
        return { state: 'processing' };
      }
      return {
        state: 'failed',
        error: {
          code: `IMAGE_${image.status ?? 'UNKNOWN'}`,
          message: 'LinkedIn could not process the image',
          category: 'terminal',
        },
      };
    },

    async publish(account, prepared, content) {
      const response = await call(account.accessToken, 'POST', '/rest/posts', {
        body: {
          author: author(account.externalId),
          commentary: toLittleText(content.text),
          visibility: 'PUBLIC',
          distribution: {
            feedDistribution: 'MAIN_FEED',
            targetEntities: [],
            thirdPartyDistributionChannels: [],
          },
          ...(prepared.ref === TEXT_ONLY ? {} : { content: { media: { id: prepared.ref } } }),
          lifecycleState: 'PUBLISHED',
          isReshareDisabledByAuthor: false,
        },
      });
      // Public now: read the id without anything that could throw.
      const urn = response.headers.get('x-restli-id');
      if (!urn) {
        // Published, but with no id to record: keep a marker rather than risk a second post.
        options.log?.warn('LinkedIn created a post without returning its id');
        return { platformPostId: 'unknown' };
      }
      return { platformPostId: urn, permalink: `https://www.linkedin.com/feed/update/${urn}/` };
    },

    /**
     * What LinkedIn will tell a member about their own post (S-21, week 8): reactions and
     * comments, through socialActions. Impressions need organisation level access, which a
     * member posting as themselves does not have, so they are simply not reported — an
     * absent number rather than an invented one.
     */
    async metrics(account, platformPostId) {
      const fetchedAt = new Date().toISOString();
      if (platformPostId === 'unknown') return { fetchedAt };
      try {
        const response = await call(
          account.accessToken,
          'GET',
          `/v2/socialActions/${encodeURIComponent(platformPostId)}`,
          { rest: false },
        );
        const body = (await response.json().catch(() => ({}))) as {
          likesSummary?: { totalLikes?: number };
          commentsSummary?: { totalFirstLevelComments?: number };
        };
        const likes = body.likesSummary?.totalLikes;
        const comments = body.commentsSummary?.totalFirstLevelComments;
        return {
          fetchedAt,
          ...(typeof likes === 'number' ? { likes } : {}),
          ...(typeof comments === 'number' ? { comments } : {}),
        };
      } catch (err) {
        options.log?.warn({ err, platformPostId }, 'linkedin reported no insights');
        return { fetchedAt };
      }
    },
  };
}
