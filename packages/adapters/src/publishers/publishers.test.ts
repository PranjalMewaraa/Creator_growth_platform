import { isAdapterError } from '@cgp/contracts';
import { describe, expect, it } from 'vitest';
import { createInstagramPublisher } from './instagram';
import { createLinkedInPublisher, toLittleText } from './linkedin';

type Reply = { status?: number; body?: unknown; headers?: Record<string, string> };

/** Answers each request with the next reply and records what was asked. */
function scripted(replies: Reply[]) {
  const calls: Array<{ method: string; url: string; body: string }> = [];
  const stub = (url: string, init?: { method?: string; body?: URLSearchParams | string }) => {
    calls.push({
      method: init?.method ?? 'GET',
      url,
      body: init?.body === undefined ? '' : init.body.toString(),
    });
    const reply = replies.shift() ?? { status: 500 };
    return Promise.resolve(
      new Response(JSON.stringify(reply.body ?? {}), {
        status: reply.status ?? 200,
        headers: reply.headers,
      }),
    );
  };
  return { fetch: stub as unknown as typeof fetch, calls };
}

const account = { externalId: '1789', accessToken: 'tok' };
const image = { kind: 'image' as const, url: 'https://cdn.example/a.jpg', mimeType: 'image/jpeg' };

describe('instagram publisher', () => {
  it('creates a container, reads its status, then publishes with the permalink', async () => {
    const net = scripted([
      { body: { id: 'container-1' } },
      { body: { status_code: 'FINISHED' } },
      { body: { id: 'media-9' } },
      { body: { permalink: 'https://instagram.com/p/abc' } },
    ]);
    const ig = createInstagramPublisher({ fetch: net.fetch });
    const content = { text: 'Hello #jaipur', media: image };

    const prepared = await ig.prepare(account, content);
    expect(prepared).toEqual({ platform: 'instagram', ref: 'container-1' });
    expect(await ig.check(account, prepared)).toEqual({ state: 'ready' });
    expect(await ig.publish(account, prepared, content)).toEqual({
      platformPostId: 'media-9',
      permalink: 'https://instagram.com/p/abc',
    });

    expect(net.calls[0]).toMatchObject({
      method: 'POST',
      url: 'https://graph.instagram.com/1789/media',
    });
    expect(net.calls[0]?.body).toContain('image_url=https%3A%2F%2Fcdn.example%2Fa.jpg');
    expect(net.calls[2]).toMatchObject({
      method: 'POST',
      url: 'https://graph.instagram.com/1789/media_publish',
    });
  });

  it('still reports the post when the permalink lookup fails after publishing', async () => {
    const net = scripted([{ body: { id: 'media-9' } }, { status: 500 }]);
    const ig = createInstagramPublisher({ fetch: net.fetch });
    expect(
      await ig.publish(account, { platform: 'instagram', ref: 'c' }, { text: 'x', media: image }),
    ).toEqual({ platformPostId: 'media-9' });
  });

  it('refuses a post without a JPEG before calling Instagram', async () => {
    const net = scripted([]);
    const ig = createInstagramPublisher({ fetch: net.fetch });
    await expect(ig.prepare(account, { text: 'no image' })).rejects.toMatchObject({
      code: 'MEDIA_REQUIRED',
      category: 'terminal',
    });
    expect(net.calls).toEqual([]);
  });

  it('maps an expired token to reauth and keeps the platform message', async () => {
    const net = scripted([
      { status: 400, body: { error: { code: 190, message: 'Error validating access token' } } },
    ]);
    const ig = createInstagramPublisher({ fetch: net.fetch });
    const err: unknown = await ig
      .prepare(account, { text: 'x', media: image })
      .catch((e: unknown) => e);
    expect(isAdapterError(err) && [err.category, err.message]).toEqual([
      'reauth',
      'Error validating access token',
    ]);
  });

  it('maps the daily publishing limit to quota', async () => {
    const net = scripted([
      { status: 400, body: { error: { code: 9, error_subcode: 2207042, message: 'limit' } } },
    ]);
    const ig = createInstagramPublisher({ fetch: net.fetch });
    await expect(
      ig.publish(account, { platform: 'instagram', ref: 'c' }, { text: 'x', media: image }),
    ).rejects.toMatchObject({ category: 'quota' });
  });

  it('reports a failed container with its status', async () => {
    const net = scripted([{ body: { status_code: 'ERROR', status: 'Unsupported aspect ratio' } }]);
    const ig = createInstagramPublisher({ fetch: net.fetch });
    expect(await ig.check(account, { platform: 'instagram', ref: 'c' })).toMatchObject({
      state: 'failed',
      error: { code: 'CONTAINER_ERROR', message: 'Unsupported aspect ratio', category: 'terminal' },
    });
  });
});

describe('linkedin publisher', () => {
  it('posts text alone without an upload', async () => {
    const net = scripted([{ status: 201, headers: { 'x-restli-id': 'urn:li:share:77' } }]);
    const li = createLinkedInPublisher({ fetch: net.fetch });
    const content = { text: 'Now shipping (Jaipur) #coldbrew' };

    const prepared = await li.prepare(account, content);
    expect(await li.check(account, prepared)).toEqual({ state: 'ready' });
    expect(await li.publish(account, prepared, content)).toEqual({
      platformPostId: 'urn:li:share:77',
      permalink: 'https://www.linkedin.com/feed/update/urn:li:share:77/',
    });
    const body = JSON.parse(net.calls[0]?.body ?? '{}') as Record<string, unknown>;
    expect(body).toMatchObject({
      author: 'urn:li:person:1789',
      commentary: 'Now shipping \\(Jaipur\\) {hashtag|\\#|coldbrew}',
      lifecycleState: 'PUBLISHED',
    });
    expect(body).not.toHaveProperty('content');
  });

  it('uploads the image, then references it in the post', async () => {
    const net = scripted([
      { body: 'image bytes' },
      { body: { value: { uploadUrl: 'https://upload.example/1', image: 'urn:li:image:5' } } },
      { status: 201 },
      { body: { status: 'AVAILABLE' } },
      { status: 201, headers: { 'x-restli-id': 'urn:li:share:78' } },
    ]);
    const li = createLinkedInPublisher({ fetch: net.fetch });
    const content = { text: 'With a photo', media: image };
    const prepared = await li.prepare(account, content);
    expect(prepared.ref).toBe('urn:li:image:5');
    expect(await li.check(account, prepared)).toEqual({ state: 'ready' });
    await li.publish(account, prepared, content);
    expect(net.calls.map((c) => c.url)).toEqual([
      'https://cdn.example/a.jpg',
      'https://api.linkedin.com/rest/images?action=initializeUpload',
      'https://upload.example/1',
      'https://api.linkedin.com/rest/images/urn%3Ali%3Aimage%3A5',
      'https://api.linkedin.com/rest/posts',
    ]);
    expect(JSON.parse(net.calls[4]?.body ?? '{}')).toMatchObject({
      content: { media: { id: 'urn:li:image:5' } },
    });
  });

  it('maps 401 to reauth', async () => {
    const net = scripted([{ status: 401, body: { message: 'Invalid access token' } }]);
    const li = createLinkedInPublisher({ fetch: net.fetch });
    await expect(
      li.publish(account, { platform: 'linkedin', ref: 'text-only' }, { text: 'x' }),
    ).rejects.toMatchObject({ category: 'reauth', message: 'Invalid access token' });
  });
});

describe('toLittleText', () => {
  it('escapes markup characters and keeps hashtags clickable', () => {
    expect(toLittleText('50% off (today) @home #Jaipur_Eats *new*')).toBe(
      '50% off \\(today\\) \\@home {hashtag|\\#|Jaipur\\_Eats} \\*new\\*',
    );
  });
});
