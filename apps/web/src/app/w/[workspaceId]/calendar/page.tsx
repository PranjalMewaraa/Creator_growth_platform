import { Card, CardHeader, EmptyState } from '@cgp/ui';
import { Screen } from '@/components/screen';

export default function CalendarPage() {
  return (
    <Screen title="Calendar" description="The week, with a status chip per platform.">
      <Card>
        <CardHeader title="This week" />
        <EmptyState
          title="No slots yet"
          description="An empty slot is the main way to start a post, so this fills up once planning begins."
        />
      </Card>
    </Screen>
  );
}
