import { Card, CardHeader, EmptyState } from '@cgp/ui';
import { Screen } from '@/components/screen';

export default function BrandPage() {
  return (
    <Screen title="Brand" description="How output sounds and looks. Every change is a new version.">
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader title="Profile" />
          <EmptyState
            title="No profile yet"
            description="Onboarding writes the first version: pillars, tone, cadence and goal."
          />
        </Card>
        <Card>
          <CardHeader title="Brand kit" />
          <EmptyState
            title="No brand kit yet"
            description="Logo, three colours, typography and tagline are applied to generated images."
          />
        </Card>
      </div>
    </Screen>
  );
}
