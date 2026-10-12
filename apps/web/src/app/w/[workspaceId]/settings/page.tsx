import { Card, CardBody, CardHeader } from '@cgp/ui';
import { Screen } from '@/components/screen';
import { requireWorkspace } from '@/server/session';

export const metadata = { title: 'Settings' };

export default async function SettingsPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  const { workspace, membership, user } = await requireWorkspace(workspaceId);

  const rows = [
    ['Workspace', workspace.name],
    ['Timezone', workspace.timezone],
    ['Your role', membership.role],
    ['Signed in as', user.email],
  ];

  return (
    <Screen title="Settings">
      <Card>
        <CardHeader title="Workspace" />
        <CardBody>
          <dl className="grid gap-3 sm:grid-cols-2">
            {rows.map(([label, value]) => (
              <div key={label} className="rounded-xl border border-line bg-raised px-4 py-3">
                <dt className="text-xs text-faint">{label}</dt>
                <dd className="mt-1 truncate text-sm text-ink">{value}</dd>
              </div>
            ))}
          </dl>
        </CardBody>
      </Card>
    </Screen>
  );
}
