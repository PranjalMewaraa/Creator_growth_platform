import { Card, CardHeader, EmptyState } from '@cgp/ui';
import { Screen } from '@/components/screen';

export default function InsightsPage() {
  return (
    <Screen
      title="Insights"
      description="What worked, measured against this workspace's own baseline."
    >
      <Card>
        <CardHeader
          title="Published posts"
          note="Numbers come from the platforms, never estimated."
        />
        <EmptyState
          title="Nothing published yet"
          description="Insights stay empty until posts have gone out and the platforms report on them."
        />
      </Card>
    </Screen>
  );
}
