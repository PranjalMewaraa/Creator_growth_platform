import { redirect } from 'next/navigation';
import { AuthFrame } from '@/components/auth-frame';
import { currentUser } from '@/server/session';
import { SignInForm } from './sign-in-form';

export const metadata = { title: 'Log in' };

/** See the comment on the root page: a route with no dynamic segment must say this itself. */
export const dynamic = 'force-dynamic';

export default async function SignInPage() {
  if (await currentUser()) redirect('/');
  return (
    <AuthFrame>
      <h1 className="text-display font-display font-semibold text-ink">Log in</h1>
      <p className="mt-2 text-sm text-muted">
        Log in with a password, or get a one-time link by email.
      </p>
      <div className="mt-8">
        <SignInForm />
      </div>
    </AuthFrame>
  );
}
