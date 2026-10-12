'use client';

import { Button, Field, Input, MailIcon } from '@cgp/ui';
import { useState, type FormEvent } from 'react';
import { authClient } from '@/lib/auth-client';

type State =
  | { status: 'idle' | 'sending' }
  | { status: 'sent'; email: string }
  | { status: 'error'; message: string };

export function SignInForm() {
  const [state, setState] = useState<State>({ status: 'idle' });

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = new FormData(event.currentTarget).get('email');
    if (typeof email !== 'string' || email.length === 0) return;

    setState({ status: 'sending' });
    const { error } = await authClient.signIn.magicLink({ email, callbackURL: '/' });
    setState(
      error
        ? {
            status: 'error',
            // Anyone can sign up (A12), so a failure here is the mail not going, not the
            // address being unknown.
            message: 'We could not send the link just now. Check the address and try again.',
          }
        : { status: 'sent', email },
    );
  }

  if (state.status === 'sent') {
    return (
      <div className="rounded-2xl border border-line bg-raised p-5">
        <span className="grid size-10 place-items-center rounded-full bg-accent/15 text-accent">
          <MailIcon />
        </span>
        <p className="mt-4 font-medium text-ink">Check your email</p>
        <p className="mt-1 text-sm text-muted">
          We sent a link to <span className="text-ink">{state.email}</span>. It works once and
          expires in five minutes. If it has not arrived in a minute, check your spam folder.
        </p>
        <Button variant="quiet" className="-ml-3 mt-3" onClick={() => setState({ status: 'idle' })}>
          Use a different email
        </Button>
      </div>
    );
  }

  return (
    <form
      onSubmit={(event) => {
        void onSubmit(event);
      }}
      className="flex flex-col gap-4"
    >
      <Field label="Email" htmlFor="email" hideLabel>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          placeholder="Enter your email"
          icon={<MailIcon />}
        />
      </Field>
      {state.status === 'error' ? <p className="text-sm text-bad">{state.message}</p> : null}
      <Button type="submit" disabled={state.status === 'sending'} className="mt-2 w-full">
        {state.status === 'sending' ? 'Sending link' : 'Send sign in link'}
      </Button>
      <p className="mt-2 text-center text-xs text-faint">
        New here? The same link creates your account.
      </p>
    </form>
  );
}
