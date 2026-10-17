import type { Logger } from '@cgp/config';
import { createTransport } from 'nodemailer';

/**
 * Outbound email (WP51). One of three ways out, chosen by what the environment holds:
 *
 *  - `RESEND_API_KEY`: Resend, over its REST API. No SDK: it is one POST, and a dependency
 *    for one POST is a dependency to keep current for nothing.
 *  - `SMTP_URL`: any SMTP server, through nodemailer — a Gmail app password, a workplace
 *    relay, or Mailpit on this machine, which is the free way to see real mail locally.
 *  - Neither: the message goes to the server log, which is how sign in worked until now and
 *    is still how it works in development.
 *
 * This module has no `server-only` import and reads no environment, so it can be tested
 * like any other function. `mailer.ts` is the one that knows the environment.
 */

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export type MailTransport = 'resend' | 'smtp' | 'log';

export interface Mailer {
  readonly transport: MailTransport;
  send(mail: Mail): Promise<void>;
}

export interface MailerOptions {
  resendApiKey?: string | undefined;
  smtpUrl?: string | undefined;
  from?: string | undefined;
  log: Logger;
  /** Tests pass a fetch that never leaves the machine. */
  fetch?: typeof fetch;
}

/** Resend's own test sender, deliverable only to the inbox that owns the key. */
export const RESEND_TEST_FROM = 'Creator Growth Platform <onboarding@resend.dev>';

export function createMailer(options: MailerOptions): Mailer {
  const { log } = options;

  if (options.resendApiKey) {
    const from = options.from ?? RESEND_TEST_FROM;
    const doFetch = options.fetch ?? fetch;
    return {
      transport: 'resend',
      async send(mail) {
        const response = await doFetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            authorization: `Bearer ${options.resendApiKey}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            from,
            to: [mail.to],
            subject: mail.subject,
            text: mail.text,
            html: mail.html,
          }),
        });
        if (!response.ok) {
          // Resend says why in the body; that is for the log, not for the person signing in.
          const detail = await response.text().catch(() => '');
          log.error({ status: response.status, detail }, 'resend refused the message');
          throw new Error(`Email could not be sent (Resend ${response.status})`);
        }
        log.info({ to: mail.to, subject: mail.subject }, 'email sent via resend');
      },
    };
  }

  if (options.smtpUrl) {
    if (!options.from) throw new Error('SMTP_URL needs EMAIL_FROM: an SMTP relay has no default');
    const transporter = createTransport(options.smtpUrl);
    const from = options.from;
    return {
      transport: 'smtp',
      async send(mail) {
        await transporter.sendMail({
          from,
          to: mail.to,
          subject: mail.subject,
          text: mail.text,
          html: mail.html,
        });
        log.info({ to: mail.to, subject: mail.subject }, 'email sent via smtp');
      },
    };
  }

  return {
    transport: 'log',
    send(mail) {
      // The text body carries the link, so a developer can sign in from the log alone.
      log.info({ to: mail.to, subject: mail.subject, body: mail.text }, 'email (no sender set)');
      return Promise.resolve();
    },
  };
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The sign in link, as plain text first and as a page second. */
export function magicLinkEmail(input: { url: string; minutes: number }): Omit<Mail, 'to'> {
  const { url, minutes } = input;
  const text = [
    'Here is your sign in link for Creator Growth Platform:',
    '',
    url,
    '',
    `It works once and expires in ${minutes} minutes. If you did not ask for it, ignore this email and nothing happens.`,
  ].join('\n');

  const safeUrl = escapeHtml(url);
  const html = `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:32px 16px;background:#0b0b0d;color:#f5f5f4;font-family:Poppins,Segoe UI,Helvetica,Arial,sans-serif">
    <div style="max-width:480px;margin:0 auto;background:#141417;border:1px solid #27272a;border-radius:16px;padding:28px">
      <p style="margin:0 0 6px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#a1a1aa">Creator Growth Platform</p>
      <h1 style="margin:0 0 16px;font-size:22px;font-weight:600">Your sign in link</h1>
      <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#d4d4d8">Tap the button to sign in. It works once and expires in ${minutes} minutes.</p>
      <p style="margin:0 0 24px"><a href="${safeUrl}" style="display:inline-block;background:#38bdf8;color:#0a1420;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:12px">Sign in</a></p>
      <p style="margin:0;font-size:12px;line-height:1.6;color:#71717a">Or paste this into your browser:<br><span style="word-break:break-all;color:#a1a1aa">${safeUrl}</span></p>
      <p style="margin:20px 0 0;font-size:12px;line-height:1.6;color:#71717a">If you did not ask for this, ignore it and nothing happens.</p>
    </div>
  </body>
</html>`;

  return { subject: 'Your sign in link', text, html };
}
