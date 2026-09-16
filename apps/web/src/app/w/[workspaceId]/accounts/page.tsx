import { Card, CardHeader, EmptyState } from '@cgp/ui';
import { Screen } from '@/components/screen';

export default function AccountsPage() {
  return (
    <Screen title="Accounts" description="Connected accounts, their scopes and their limits.">
      <Card>
        <CardHeader title="Connections" />
        <EmptyState
          title="No accounts connected"
          description="Instagram and LinkedIn connect here. Each one states plainly what it can and cannot do."
        />
      </Card>
    </Screen>
  );
}
