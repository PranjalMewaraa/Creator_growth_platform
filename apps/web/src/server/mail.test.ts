import { createLogger } from '@cgp/config';
import { describe, expect, it } from 'vitest';
import { createMailer, magicLinkEmail, RESEND_TEST_FROM } from './mail';

/** A fetch that records what it was asked and answers with the given response. */
function recording(status: number, body = '{}') {
  const calls: Array<{ url: string; body: string; headers: Headers }> = [];
  const fake: typeof fetch = (input, init) => {
    calls.push({
      url: typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
      body: typeof init?.body === 'string' ? init.body : '',
      headers: new Headers(init?.headers),
    });
    return Promise.resolve(new Response(body, { status }));
  };
  return { calls, fetch: fake };
}

interface Sent {
  from: string;
  to: string[];
  subject: string;
  text: string;
  html: string;
}

const log = createLogger({ service: 'test', level: 'silent' });
const mail = {
  to: 'someone@example.com',
  subject: 'Hello',
  text: 'plain',
  html: '<p>plain</p>',
};

describe('the mailer', () => {
  it('falls back to the log when nothing is configured, and never throws', async () => {
    const mailer = createMailer({ log });
    expect(mailer.transport).toBe('log');
    await expect(mailer.send(mail)).resolves.toBeUndefined();
  });

  it('posts to Resend with the key, the test sender by default, and the whole message', async () => {
    const { calls, fetch } = recording(200, '{"id":"1"}');
    const mailer = createMailer({ log, resendApiKey: 're_test', fetch });
    expect(mailer.transport).toBe('resend');
    await mailer.send(mail);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('https://api.resend.com/emails');
    expect(calls[0]?.headers.get('authorization')).toBe('Bearer re_test');
    expect(JSON.parse(calls[0]?.body ?? '{}') as Sent).toEqual({
      from: RESEND_TEST_FROM,
      to: ['someone@example.com'],
      subject: 'Hello',
      text: 'plain',
      html: '<p>plain</p>',
    });
  });

  it('uses the configured sender over the test one', async () => {
    const { calls, fetch } = recording(200);
    const mailer = createMailer({
      log,
      resendApiKey: 're_test',
      from: 'Studio <hello@studio.example>',
      fetch,
    });
    await mailer.send(mail);
    const sent = JSON.parse(calls[0]?.body ?? '{}') as Sent;
    expect(sent.from).toBe('Studio <hello@studio.example>');
  });

  it('fails loudly when Resend refuses, with the status and not the body', async () => {
    const { fetch } = recording(403, '{"message":"domain not verified"}');
    const mailer = createMailer({ log, resendApiKey: 're_test', fetch });
    await expect(mailer.send(mail)).rejects.toThrow(/Resend 403/);
  });

  it('refuses SMTP without a sender, because a relay has no default', () => {
    expect(() => createMailer({ log, smtpUrl: 'smtp://localhost:1025' })).toThrow(/EMAIL_FROM/);
    expect(
      createMailer({ log, smtpUrl: 'smtp://localhost:1025', from: 'Studio <a@b.c>' }).transport,
    ).toBe('smtp');
  });

  it('prefers Resend when both are set', () => {
    const mailer = createMailer({
      log,
      resendApiKey: 're_test',
      smtpUrl: 'smtp://localhost:1025',
      from: 'Studio <a@b.c>',
    });
    expect(mailer.transport).toBe('resend');
  });
});

describe('the sign in email', () => {
  it('carries the link in the text body, so a log alone is enough to sign in', () => {
    const message = magicLinkEmail({ url: 'https://app.example/verify?token=abc', minutes: 5 });
    expect(message.text).toContain('https://app.example/verify?token=abc');
    expect(message.text).toContain('5 minutes');
    expect(message.subject).toBe('Your sign in link');
  });

  it('escapes the URL in the page, so a token cannot break out of the link', () => {
    const message = magicLinkEmail({ url: 'https://x.example/?a=1&b="<2>"', minutes: 5 });
    expect(message.html).toContain('a=1&amp;b=&quot;&lt;2&gt;&quot;');
    expect(message.html).not.toContain('"<2>"');
  });
});
