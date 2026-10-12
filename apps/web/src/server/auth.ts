import 'server-only';
import { authDatabaseAdapter } from '@cgp/db';
import { betterAuth } from 'better-auth';
import { magicLink } from 'better-auth/plugins';
import { getMailer, magicLinkEmail } from './mailer';
import { getDb, getEnv, getLogger } from './runtime';

/** How long a sign in link lives. The email and the sign in form both say this number. */
const MAGIC_LINK_MINUTES = 5;

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
        // Anyone with an inbox can sign up (A12, WP51): an unknown address becomes an
        // account, and the root page sends a user with no workspace to create one. A11's
        // restriction to seeded addresses was for a demo nobody outside the team could reach;
        // with mail actually delivered, it was the only thing standing between a visitor and
        // the first run flow built for them.
        disableSignUp: false,
        expiresIn: MAGIC_LINK_MINUTES * 60,
        sendMagicLink: async ({ email, url }) => {
          const mailer = getMailer();
          try {
            await mailer.send({
              to: email,
              ...magicLinkEmail({ url, minutes: MAGIC_LINK_MINUTES }),
            });
          } catch (err) {
            // A link that cannot be sent is a sign in that cannot happen; say so where it can
            // be seen, and fail the request so the form says so too.
            getLogger().error({ err, email, transport: mailer.transport }, 'magic link not sent');
            throw err;
          }
        },
      }),
    ],
  });
}

const cache = globalThis as typeof globalThis & { cgpAuth?: ReturnType<typeof buildAuth> };

export function getAuth() {
  return (cache.cgpAuth ??= buildAuth());
}
