import 'server-only';
import { createMailer, type Mailer } from './mail';
import { getEnv, getLogger } from './runtime';

export { magicLinkEmail, type Mail, type Mailer } from './mail';

const cache = globalThis as typeof globalThis & { cgpMailer?: Mailer };

/** One mailer per process, built from the environment on first use (WP51). */
export function getMailer(): Mailer {
  if (!cache.cgpMailer) {
    const env = getEnv();
    cache.cgpMailer = createMailer({
      resendApiKey: env.RESEND_API_KEY,
      smtpUrl: env.SMTP_URL,
      from: env.EMAIL_FROM,
      log: getLogger(),
    });
  }
  return cache.cgpMailer;
}
