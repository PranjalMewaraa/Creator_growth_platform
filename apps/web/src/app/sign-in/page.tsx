import { redirect } from 'next/navigation';
import { AuthFrame } from '@/components/auth-frame';
import { currentUser } from '@/server/session';
import { SignInForm } from './sign-in-form';

export const metadata = { title: 'Log in' };

export default async function SignInPage() {
  if (await currentUser()) redirect('/');
  return (
    <AuthFrame>
      <h1 className="text-3xl font-semibold tracking-tight text-ink">Log in</h1>
      <p className="mt-2 text-sm text-muted">We&apos;ll email you a link. No password, no card.</p>
      <div className="mt-8">
        <SignInForm />
      </div>
    </AuthFrame>
  );
}
