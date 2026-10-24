'use client';

import { Button, Field, Input, MailIcon } from '@cgp/ui';
import { useState, type FormEvent } from 'react';
import { authClient } from '@/lib/auth-client';

type Mode = 'magic' | 'login' | 'signup';

type State =
  | { status: 'idle' | 'sending' }
  | { status: 'sent'; email: string }
  | { status: 'error'; message: string };

const TABS: Array<{ mode: Mode; label: string }> = [
  { mode: 'login', label: 'Log in' },
  { mode: 'signup', label: 'Sign up' },
  { mode: 'magic', label: 'Email link' },
];

export function SignInForm() {
  const [mode, setMode] = useState<Mode>('login');
  const [state, setState] = useState<State>({ status: 'idle' });

  function switchMode(next: Mode) {
    setMode(next);
    setState({ status: 'idle' });
  }

  async function onSubmitMagicLink(event: FormEvent<HTMLFormElement>) {
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

  async function onSubmitPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const email = data.get('email');
    const password = data.get('password');
    if (typeof email !== 'string' || typeof password !== 'string') return;

    setState({ status: 'sending' });
    const { error } =
      mode === 'signup'
        ? await authClient.signUp.email({
            email,
            password,
            name: (data.get('name') as string) || email.split('@')[0] || email,
            callbackURL: '/',
          })
        : await authClient.signIn.email({ email, password, callbackURL: '/' });
    if (error) {
      setState({ status: 'error', message: error.message ?? 'That did not work. Try again.' });
      return;
    }
    window.location.href = '/';
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
        <Button variant="quiet" className="-ml-3 mt-3" onClick={() => switchMode('login')}>
          Use a different method
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex gap-1 rounded-xl border border-line bg-raised p-1">
        {TABS.map((tab) => (
          <button
            key={tab.mode}
            type="button"
            onClick={() => switchMode(tab.mode)}
            className={`flex-1 rounded-lg px-3 py-1.5 text-sm font-medium transition ${
              mode === tab.mode ? 'bg-accent/15 text-accent' : 'text-muted hover:text-ink'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {mode === 'magic' ? (
        <form
          onSubmit={(event) => {
            void onSubmitMagicLink(event);
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
      ) : (
        <form
          onSubmit={(event) => {
            void onSubmitPassword(event);
          }}
          className="flex flex-col gap-4"
        >
          {mode === 'signup' ? (
            <Field label="Name" htmlFor="name" hideLabel>
              <Input id="name" name="name" type="text" autoComplete="name" placeholder="Your name" />
            </Field>
          ) : null}
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
          <Field label="Password" htmlFor="password" hideLabel>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
              required
              minLength={mode === 'signup' ? 8 : undefined}
              placeholder={mode === 'signup' ? 'Create a password (min 8 characters)' : 'Password'}
            />
          </Field>
          {state.status === 'error' ? <p className="text-sm text-bad">{state.message}</p> : null}
          <Button type="submit" disabled={state.status === 'sending'} className="mt-2 w-full">
            {state.status === 'sending'
              ? mode === 'signup'
                ? 'Creating account'
                : 'Logging in'
              : mode === 'signup'
                ? 'Create account'
                : 'Log in'}
          </Button>
        </form>
      )}
    </div>
  );
}
