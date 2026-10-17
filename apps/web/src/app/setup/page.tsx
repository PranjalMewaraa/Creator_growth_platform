import { AuthFrame } from '@/components/auth-frame';
import { requireUser } from '@/server/session';
import { SetupForm } from './setup-form';

export const metadata = { title: 'Create a workspace' };

/** See the comment on the root page: a route with no dynamic segment must say this itself. */
export const dynamic = 'force-dynamic';

/** S-02: establish the tenant. Who the workspace is for comes later, in onboarding. */
export default async function SetupPage() {
  const user = await requireUser();
  return (
    <AuthFrame>
      <h1 className="text-display font-display font-semibold text-ink">Create a workspace</h1>
      <p className="mt-2 text-sm text-muted">
        Signed in as <span className="text-ink">{user.email}</span>. A workspace holds your profile,
        brand kit, calendar and credits.
      </p>
      <div className="mt-8">
        <SetupForm />
      </div>
    </AuthFrame>
  );
}
