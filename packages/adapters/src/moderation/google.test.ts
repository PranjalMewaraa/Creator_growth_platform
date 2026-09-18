import { isAdapterError } from '@cgp/contracts';
import { describe, expect, it } from 'vitest';
import { createGoogleModeration, TEXT_BLOCK_THRESHOLD } from './google';

function answering(status: number, body: unknown) {
  const requests: Array<{ url: string; headers: Headers; body: unknown }> = [];
  const fetchStub = (url: string, init: { headers: Headers; body: string }) => {
    requests.push({ url, headers: init.headers, body: JSON.parse(init.body) as unknown });
    return Promise.resolve(new Response(JSON.stringify(body), { status }));
  };
  const moderation = createGoogleModeration({
    project: 'test-project',
    fetch: fetchStub as unknown as typeof fetch,
    authHeaders: () => Promise.resolve({ authorization: 'Bearer test' }),
  });
  return { moderation, requests };
}

describe('google moderation, text', () => {
  it('allows text whose categories stay under the threshold or never block', async () => {
    const { moderation, requests } = answering(200, {
      moderationCategories: [
        { name: 'Toxic', confidence: TEXT_BLOCK_THRESHOLD - 0.01 },
        { name: 'Politics', confidence: 0.99 },
        { name: 'Finance', confidence: 0.95 },
      ],
    });
    expect(await moderation.checkText('Budget speech reaction')).toEqual({
      allowed: true,
      flagged: [],
    });
    expect(requests[0]).toMatchObject({
      url: 'https://language.googleapis.com/v2/documents:moderateText',
      body: { document: { type: 'PLAIN_TEXT', content: 'Budget speech reaction' } },
    });
    expect(requests[0]?.headers.get('x-goog-user-project')).toBe('test-project');
  });

  it('blocks with our category names, one entry each, highest first', async () => {
    const { moderation } = answering(200, {
      moderationCategories: [
        { name: 'Insult', confidence: 0.85 },
        { name: 'Toxic', confidence: 0.92 },
        { name: 'Violent', confidence: 0.97 },
      ],
    });
    expect(await moderation.checkText('x')).toEqual({
      allowed: false,
      flagged: [
        { category: 'violence', score: 0.97 },
        { category: 'harassment', score: 0.92 },
      ],
    });
  });

  it('normalises a provider failure without its message', async () => {
    const { moderation } = answering(403, { error: { message: 'API not enabled on project' } });
    const err: unknown = await moderation.checkText('x').catch((e: unknown) => e);
    expect(isAdapterError(err) && err.code).toBe('HTTP_403');
    expect(isAdapterError(err) && err.message).not.toContain('API not enabled');
  });
});

describe('google moderation, images', () => {
  const png = { data: new Uint8Array([1, 2, 3]), mimeType: 'image/png' };

  it('blocks likely adult or violent images and very likely racy ones', async () => {
    const { moderation, requests } = answering(200, {
      responses: [
        { safeSearchAnnotation: { adult: 'LIKELY', violence: 'POSSIBLE', racy: 'LIKELY' } },
      ],
    });
    expect(await moderation.checkImage(png)).toEqual({
      allowed: false,
      flagged: [{ category: 'sexual', score: 0.8 }],
    });
    expect(requests[0]?.body).toMatchObject({
      requests: [{ image: { content: 'AQID' }, features: [{ type: 'SAFE_SEARCH_DETECTION' }] }],
    });
  });

  it('allows an ordinary image', async () => {
    const { moderation } = answering(200, {
      responses: [{ safeSearchAnnotation: { adult: 'VERY_UNLIKELY', violence: 'UNLIKELY' } }],
    });
    expect(await moderation.checkImage(png)).toEqual({ allowed: true, flagged: [] });
  });

  it('treats a per image error as a failure, not an allow', async () => {
    const { moderation } = answering(200, { responses: [{ error: { code: 400 } }] });
    await expect(moderation.checkImage(png)).rejects.toMatchObject({ code: 'HTTP_400' });
  });
});
