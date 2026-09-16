import { Card, CardHeader, EmptyState } from '@cgp/ui';
import { Screen } from '@/components/screen';

export default function StudioPage() {
  return (
    <Screen
      title="Studio"
      description="Type what you want in plain words. The compiled prompt stays visible."
    >
      <Card>
        <CardHeader title="Generate" />
        <EmptyState
          title="Generation is not wired up yet"
          description="Templates, the orchestration engine and the credit hold land before this screen can run a job."
        />
      </Card>
    </Screen>
  );
}
