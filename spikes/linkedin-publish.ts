// WP5 spike: can we post to a member's LinkedIn profile with "Share on LinkedIn" in
// developer mode? Throwaway by design (plan section 11, week 1). The real adapter is WP30.
//
//   node spikes/linkedin-publish.ts                   dry run: token, member, image upload
//   node spikes/linkedin-publish.ts --publish         also creates the post, a real public post
//   --image-url <public image>   --text <commentary>   --version <YYYYMM>
//
// Reads LINKEDIN_ACCESS_TOKEN from the repo root .env. Never prints the token.

export {}; // A module, so top level await typechecks.

const API = 'https://api.linkedin.com';

// Lorem Picsum serves Unsplash licensed photos. 1200x627 is LinkedIn's recommended link ratio.
const DEFAULT_IMAGE = 'https://picsum.photos/id/1015/1200/627.jpg';
const DEFAULT_TEXT =
  'Test post from the Creator Growth Platform publishing spike (developer mode). Safe to ignore.';

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

process.loadEnvFile('.env');
const token = process.env.LINKEDIN_ACCESS_TOKEN;
if (!token) throw new Error('LINKEDIN_ACCESS_TOKEN is not set in .env');

const publish = process.argv.includes('--publish');
const text = arg('--text') ?? DEFAULT_TEXT;
// The versioned REST APIs need a LinkedIn-Version header naming an active monthly release.
const version = arg('--version') ?? '202608';

const auth = { authorization: `Bearer ${token}` };
const rest = { ...auth, 'LinkedIn-Version': version, 'X-Restli-Protocol-Version': '2.0.0' };

async function call(
  method: string,
  path: string,
  { headers = rest, body }: { headers?: Record<string, string>; body?: unknown } = {},
): Promise<Response> {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: body ? { ...headers, 'content-type': 'application/json' } : headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) {
    // Report the path and LinkedIn's error body only; the token is in a header, never logged.
    throw new Error(`${method} ${path} -> HTTP ${response.status}: ${await response.text()}`);
  }
  return response;
}

const elapsed = (since: number) => `${((Date.now() - since) / 1000).toFixed(1)}s`;

// OpenID Connect userinfo: `sub` is the member id used in the author URN.
const me = (await (await call('GET', '/v2/userinfo', { headers: auth })).json()) as {
  sub: string;
  name?: string;
};
const author = `urn:li:person:${me.sub}`;
console.log(`Member: ${me.name ?? '(no name)'}, ${author}`);

const imageResponse = await fetch(arg('--image-url') ?? DEFAULT_IMAGE, { redirect: 'follow' });
if (!imageResponse.ok)
  throw new Error(`Could not fetch the test image: HTTP ${imageResponse.status}`);
const imageBytes = new Uint8Array(await imageResponse.arrayBuffer());
console.log(`Image: ${imageResponse.url} (${(imageBytes.length / 1024).toFixed(0)} KB)`);

// Register the upload, then PUT the bytes. Nothing is public until a post references the image.
const uploadStart = Date.now();
const init = (await (
  await call('POST', '/rest/images?action=initializeUpload', {
    body: { initializeUploadRequest: { owner: author } },
  })
).json()) as { value: { uploadUrl: string; image: string } };
console.log(`Upload registered: ${init.value.image} in ${elapsed(uploadStart)}`);

const put = await fetch(init.value.uploadUrl, { method: 'PUT', headers: auth, body: imageBytes });
if (!put.ok) throw new Error(`Image upload -> HTTP ${put.status}: ${await put.text()}`);
console.log(`Image uploaded in ${elapsed(uploadStart)}`);

let status = 'PROCESSING';
while (status !== 'AVAILABLE' && Date.now() - uploadStart < 60_000) {
  const image = (await (
    await call('GET', `/rest/images/${encodeURIComponent(init.value.image)}`)
  ).json()) as { status: string };
  status = image.status;
  if (status === 'PROCESSING' || status === 'WAITING_UPLOAD') {
    await new Promise((resolve) => setTimeout(resolve, 2000));
  } else {
    console.log(`Image status ${status} after ${elapsed(uploadStart)}`);
    if (status !== 'AVAILABLE') break;
  }
}
if (status !== 'AVAILABLE') throw new Error(`Image not ready: ${status}`);

if (!publish) {
  console.log('Dry run: image is uploaded but no post was created.');
  process.exit(0);
}

const postStart = Date.now();
const post = await call('POST', '/rest/posts', {
  body: {
    author,
    commentary: text,
    visibility: 'PUBLIC',
    distribution: {
      feedDistribution: 'MAIN_FEED',
      targetEntities: [],
      thirdPartyDistributionChannels: [],
    },
    content: { media: { id: init.value.image, altText: 'Mountain valley landscape' } },
    lifecycleState: 'PUBLISHED',
    isReshareDisabledByAuthor: false,
  },
});
const postUrn = post.headers.get('x-restli-id');
console.log(
  `PUBLISHED ${postUrn ?? '(no id returned)'} in ${elapsed(postStart)}` +
    (postUrn ? `: https://www.linkedin.com/feed/update/${postUrn}/` : ''),
);
