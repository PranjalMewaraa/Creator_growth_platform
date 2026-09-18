// WP5 spike: can we publish to Instagram in developer mode through Instagram Login?
// Throwaway by design (plan section 11, week 1). The real adapter comes in WP29.
//
//   node spikes/instagram-publish.ts                   dry run: token, account, quota, container
//   node spikes/instagram-publish.ts --publish         also publishes, a real public post
//   --image-url <public jpeg>   --caption <text>
//
// Reads META_APP_ID and INSTAGRAM_ACCESS_TOKEN from the repo root .env. Never prints the token.

export {}; // A module, so top level await typechecks.

const API = 'https://graph.instagram.com';

// Lorem Picsum serves Unsplash licensed photos. 1080x1350 is 4:5, the tallest feed ratio.
const DEFAULT_IMAGE = 'https://picsum.photos/id/1015/1080/1350.jpg';
const DEFAULT_CAPTION =
  'Test post from the Creator Growth Platform publishing spike (developer mode). Safe to ignore.';

interface GraphError {
  message?: string;
  type?: string;
  code?: number;
  error_subcode?: number;
  fbtrace_id?: string;
}

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

process.loadEnvFile('.env');
const token = process.env.INSTAGRAM_ACCESS_TOKEN;
if (!token) throw new Error('INSTAGRAM_ACCESS_TOKEN is not set in .env');

const publish = process.argv.includes('--publish');
const caption = arg('--caption') ?? DEFAULT_CAPTION;

async function graph<T>(
  path: string,
  {
    method = 'GET',
    params = {},
  }: { method?: 'GET' | 'POST'; params?: Record<string, string> } = {},
): Promise<T> {
  const query = new URLSearchParams({ ...params, access_token: token! });
  const response = await fetch(
    `${API}${path}${method === 'GET' ? `?${query.toString()}` : ''}`,
    method === 'POST'
      ? {
          method,
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: query,
        }
      : undefined,
  );
  const body = (await response.json()) as T & { error?: GraphError };
  if (!response.ok || body.error) {
    // The URL carries the token, so only the path and the Graph error are reported.
    const e = body.error ?? {};
    throw new Error(
      `${method} ${path} -> HTTP ${response.status}: ${e.message ?? 'unknown error'} ` +
        `(type ${e.type}, code ${e.code}, subcode ${e.error_subcode}, trace ${e.fbtrace_id})`,
    );
  }
  return body;
}

/** Instagram fetches the image itself, so it must be a public JPEG. Follow redirects first. */
async function resolveImage(url: string): Promise<string> {
  const response = await fetch(url, { method: 'HEAD', redirect: 'follow' });
  const type = response.headers.get('content-type') ?? '';
  if (!response.ok || !type.includes('jpeg')) {
    throw new Error(`Image must be a reachable JPEG; got HTTP ${response.status}, ${type}`);
  }
  return response.url;
}

const elapsed = (since: number) => `${((Date.now() - since) / 1000).toFixed(1)}s`;

const me = await graph<{
  user_id: string;
  username: string;
  account_type?: string;
  media_count?: number;
}>('/me', { params: { fields: 'user_id,username,account_type,media_count' } });
console.log(`Account: @${me.username} (${me.account_type ?? 'type unknown'}), id ${me.user_id}`);

const limit = await graph<{
  data?: Array<{
    quota_usage?: number;
    config?: { quota_total?: number; quota_duration?: number };
  }>;
}>(`/${me.user_id}/content_publishing_limit`, { params: { fields: 'quota_usage,config' } });
const quota = limit.data?.[0];
console.log(
  `Publishing quota: ${quota?.quota_usage ?? '?'} used of ${quota?.config?.quota_total ?? '?'} ` +
    `per ${quota?.config?.quota_duration ? quota.config.quota_duration / 3600 : '?'}h`,
);

const imageUrl = await resolveImage(arg('--image-url') ?? DEFAULT_IMAGE);
console.log(`Image: ${imageUrl}`);

const containerStart = Date.now();
const container = await graph<{ id: string }>(`/${me.user_id}/media`, {
  method: 'POST',
  params: { image_url: imageUrl, caption },
});
console.log(`Container ${container.id} created in ${elapsed(containerStart)}`);

let status = 'IN_PROGRESS';
while (status === 'IN_PROGRESS' && Date.now() - containerStart < 120_000) {
  const check = await graph<{ status_code: string; status?: string }>(`/${container.id}`, {
    params: { fields: 'status_code,status' },
  });
  status = check.status_code;
  if (status === 'IN_PROGRESS') await new Promise((resolve) => setTimeout(resolve, 2000));
  else
    console.log(
      `Container status ${status} after ${elapsed(containerStart)}${check.status ? ` (${check.status})` : ''}`,
    );
}
if (status !== 'FINISHED') throw new Error(`Container not ready: ${status}`);

if (!publish) {
  console.log('Dry run: container is ready but NOT published. Unused containers expire after 24h.');
  process.exit(0);
}

const publishStart = Date.now();
const published = await graph<{ id: string }>(`/${me.user_id}/media_publish`, {
  method: 'POST',
  params: { creation_id: container.id },
});
const media = await graph<{ permalink?: string; timestamp?: string }>(`/${published.id}`, {
  params: { fields: 'permalink,timestamp' },
});
console.log(
  `PUBLISHED media ${published.id} in ${elapsed(publishStart)}: ${media.permalink ?? '(no permalink)'}`,
);
