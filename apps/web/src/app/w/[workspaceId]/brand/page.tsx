import { PROFILE_OPTIONS, profileHistory } from '@cgp/core';
import { Card, CardBody, CardHeader, EmptyState } from '@cgp/ui';
import Link from 'next/link';
import { Screen } from '@/components/screen';
import { getDb } from '@/server/runtime';
import { requireWorkspace } from '@/server/session';
import { ProfileEditor } from './profile-editor';

function when(iso: string, timezone: string) {
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: timezone,
  }).format(new Date(iso));
}

export default async function BrandPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string }>;
  searchParams: Promise<{ saved?: string }>;
}) {
  const { workspaceId } = await params;
  const { saved } = await searchParams;
  const { workspace } = await requireWorkspace(workspaceId);
  const history = await profileHistory(getDb(), workspaceId);
  const [latest] = history;
  const onboarding = `/w/${workspaceId}/onboarding`;

  return (
    <Screen
      title="Brand"
      description="How your content should sound, and what it should look like."
    >
      {saved && latest ? (
        <p className="rounded-xl border border-good/40 bg-good/10 px-4 py-3 text-sm text-ink">
          Profile saved as version {latest.version}. Every generation now uses it.
        </p>
      ) : null}

      {!latest ? (
        <Card>
          <EmptyState
            title="No profile yet"
            description="Eight quick questions about what you make and how it should sound. Nothing can be generated until they are answered."
            action={
              <Link
                href={onboarding}
                className="inline-flex h-11 items-center rounded-xl bg-accent px-5 text-sm font-medium text-accent-ink"
              >
                Set up your profile
              </Link>
            }
          />
        </Card>
      ) : (
        <div className="grid items-start gap-4 2xl:grid-cols-[minmax(0,1fr)_340px]">
          <Card>
            <CardHeader
              title={`Profile · version ${latest.version}`}
              note="Corrections are saved as a new version; older versions stay, because past posts point at them."
              action={
                <Link href={onboarding} className="text-xs text-muted hover:text-ink">
                  Walk through the questions again
                </Link>
              }
            />
            <CardBody>
              <ProfileEditor
                // Remount when a new version lands, so the form starts from it.
                key={latest.version}
                workspaceId={workspaceId}
                options={PROFILE_OPTIONS}
                current={latest.profile}
                version={latest.version}
              />
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Version history" note="Newest first." />
            <CardBody>
              <ol className="flex flex-col gap-2">
                {history.map((entry, i) => (
                  <li key={entry.version}>
                    <details className="group rounded-xl border border-line bg-raised px-4 py-3">
                      <summary className="flex cursor-pointer list-none items-start justify-between gap-3">
                        <span>
                          <span className="text-sm font-medium text-ink">
                            Version {entry.version}
                          </span>
                          {i === 0 ? (
                            <span className="ml-2 rounded-full bg-accent/15 px-2 py-0.5 text-[11px] text-accent">
                              In use
                            </span>
                          ) : null}
                          <span className="mt-0.5 block text-xs text-muted">
                            {entry.changes.join(', ')}
                          </span>
                        </span>
                        <span className="shrink-0 text-xs text-muted">
                          {when(entry.createdAt, workspace.timezone)}
                        </span>
                      </summary>
                      <dl className="mt-3 grid gap-1.5 border-t border-line pt-3 text-xs">
                        <Row label="Makes" value={entry.profile.contentTypes.join(', ')} />
                        <Row label="Posts to" value={entry.profile.platforms.join(', ')} />
                        <Row label="Who" value={entry.profile.teamShape} />
                        <Row label="Pillars" value={entry.profile.pillars.join(', ')} />
                        <Row label="Goal" value={entry.profile.goal90d} />
                        <Row label="Cadence" value={entry.profile.cadence} />
                        <Row label="Tone" value={entry.profile.tone} />
                        <Row label="Avoid" value={entry.profile.prohibitedWords.join(', ')} />
                      </dl>
                    </details>
                  </li>
                ))}
              </ol>
            </CardBody>
          </Card>
        </div>
      )}

      <Card>
        <CardHeader title="Brand kit" note="Logo, three colours, typography and tagline." />
        <EmptyState
          title="Coming next"
          description="The brand kit editor arrives in the next step. Until then the demo kit is used."
        />
      </Card>
    </Screen>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[70px_1fr] gap-2">
      <dt className="text-muted">{label}</dt>
      <dd className="text-ink">{value || '—'}</dd>
    </div>
  );
}
