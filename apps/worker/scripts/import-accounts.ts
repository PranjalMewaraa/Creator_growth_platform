// Connects the demo's social accounts from the tokens in .env, until the OAuth connect flow
// (WP28) exists. Tokens are stored envelope encrypted (D11) and never printed.
//
//   pnpm --filter @cgp/worker accounts:import <workspace id>
//
// Reads INSTAGRAM_ACCESS_TOKEN and LINKEDIN_ACCESS_TOKEN; either may be missing. Running it again
// refreshes the stored token.
import {
  baseEnvSchema,
  encryptSecret,
  loadRootEnvFile,
  parseEncryptionKey,
  parseEnv,
} from '@cgp/config';
import { createDatabase, upsertSocialAccount } from '@cgp/db';

loadRootEnvFile();
const env = parseEnv(baseEnvSchema);
const [workspaceId] = process.argv.slice(2);
if (!workspaceId) throw new Error('Usage: accounts:import <workspace id>');
const kek = parseEncryptionKey(env.TOKEN_ENCRYPTION_KEY);
const db = createDatabase(env.DATABASE_URL, { max: 1 });

async function getJson<T>(url: string, headers: Record<string, string> = {}): Promise<T> {
  const response = await fetch(url, { headers });
  if (!response.ok) {
    // The URL may carry a token, so only the host and status are reported.
    throw new Error(`${new URL(url).host} answered HTTP ${response.status}`);
  }
  return (await response.json()) as T;
}

try {
  const instagram = process.env.INSTAGRAM_ACCESS_TOKEN;
  if (instagram) {
    const me = await getJson<{ user_id: string; username: string }>(
      `https://graph.instagram.com/me?fields=user_id,username&access_token=${encodeURIComponent(instagram)}`,
    );
    const row = await upsertSocialAccount(db, {
      workspaceId,
      platform: 'instagram',
      externalId: me.user_id,
      displayName: `@${me.username}`,
      scopes: ['instagram_business_basic', 'instagram_business_content_publish'],
      tokenCiphertext: encryptSecret(kek, instagram),
      tokenExpiresAt: null,
    });
    console.log(`Instagram connected: @${me.username} (${row.id})`);
  } else {
    console.log('INSTAGRAM_ACCESS_TOKEN not set; skipped Instagram');
  }

  const linkedin = process.env.LINKEDIN_ACCESS_TOKEN;
  if (linkedin) {
    const me = await getJson<{ sub: string; name?: string }>(
      'https://api.linkedin.com/v2/userinfo',
      {
        authorization: `Bearer ${linkedin}`,
      },
    );
    const row = await upsertSocialAccount(db, {
      workspaceId,
      platform: 'linkedin',
      externalId: me.sub,
      displayName: me.name ?? null,
      scopes: ['openid', 'profile', 'w_member_social'],
      tokenCiphertext: encryptSecret(kek, linkedin),
      tokenExpiresAt: null,
    });
    console.log(`LinkedIn connected: ${me.name ?? me.sub} (${row.id})`);
  } else {
    console.log('LINKEDIN_ACCESS_TOKEN not set; skipped LinkedIn');
  }
} finally {
  await db.close();
}
