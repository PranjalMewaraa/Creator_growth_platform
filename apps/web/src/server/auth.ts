import 'server-only';
import { authDatabaseAdapter } from '@cgp/db';
import { betterAuth } from 'better-auth';
import { magicLink } from 'better-auth/plugins';
import { getDb, getEnv, getLogger } from './runtime';

function buildAuth() {
  const env = getEnv();
  return betterAuth({
    database: authDatabaseAdapter(getDb()),
    secret: env.AUTH_SECRET,
    baseURL: env.APP_URL,
    // Identity ids are uuids, like every other id in the schema.
    advanced: { database: { generateId: 'uuid' } },
    emailAndPassword: { enabled: false },
    plugins: [
      magicLink({
        // A11: only addresses the seed created can sign in. An unknown email is refused
        // rather than turned into a new account.
        disableSignUp: true,
        sendMagicLink: ({ email, url }) => {
          if (!env.RESEND_API_KEY) {
            // No sender configured yet: the link goes to the server log so local sign in works.
            getLogger().info({ email, url }, 'magic link (no email sender configured)');
            return;
          }
          throw new Error('Email delivery is not implemented yet; unset RESEND_API_KEY');
        },
      }),
    ],
  });
}

const cache = globalThis as typeof globalThis & { cgpAuth?: ReturnType<typeof buildAuth> };

export function getAuth() {
  return (cache.cgpAuth ??= buildAuth());
}
