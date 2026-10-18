'use client';

import type { TrendListView } from '@cgp/core';
import type { TrendView } from '@cgp/contracts';
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, Select, Tabs } from '@cgp/ui';
import Link from 'next/link';
import { useState } from 'react';

type Angle = 'contrarian' | 'howTo' | 'predictive';

const ANGLE_LABELS: Record<Angle, string> = {
  contrarian: 'Contrarian',
  howTo: 'How-to',
  predictive: 'Predictive',
};

const STAGE_LABEL: Record<TrendView['lifecycleStage'], string> = {
  rising: 'Rising',
  peak: 'Peaking',
  evergreen: 'Evergreen',
  decaying: 'Fading',
};

const STAGE_TONE: Record<TrendView['lifecycleStage'], 'good' | 'accent' | 'neutral' | 'warn'> = {
  rising: 'good',
  peak: 'accent',
  evergreen: 'neutral',
  decaying: 'warn',
};

const SOURCE_LABEL: Record<TrendView['sourcePlatform'], string> = {
  youtube: 'YouTube',
  autocomplete: 'Search',
  reddit: 'Reddit',
  blended: 'Blended',
};

function TrendCard({
  workspaceId,
  trend,
  saved,
  onToggleSave,
}: {
  workspaceId: string;
  trend: TrendView;
  saved: boolean;
  onToggleSave: (trendId: string, save: boolean) => void;
}) {
  const [angle, setAngle] = useState<Angle>('contrarian');
  const [saving, setSaving] = useState(false);

  const angleText = trend.creativeAngles[angle];
  const useIntent = trend.suggestedHooks[0] ?? angleText ?? trend.summary;
  const tagEntries = Object.entries(trend.recommendedTags) as Array<
    [string, string[] | undefined]
  >;
  const tags = tagEntries.flatMap(([platform, list]) =>
    (list ?? []).map((tag) => `#${tag.replace(/^#/, '')} · ${platform}`),
  );

  return (
    <li className="flex flex-col gap-4 rounded-2xl border border-line bg-raised p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={STAGE_TONE[trend.lifecycleStage]}>{STAGE_LABEL[trend.lifecycleStage]}</Badge>
            <Badge tone="neutral">{SOURCE_LABEL[trend.sourcePlatform]}</Badge>
            {trend.searchVolumeIndicator ? (
              <span className="text-caption text-faint">{trend.searchVolumeIndicator}</span>
            ) : null}
          </div>
          <h3 className="mt-1.5 text-subtitle font-medium text-ink">{trend.topicTitle}</h3>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-0.5">
          <span className="text-title font-display font-semibold text-ink font-mono tabular-nums">
            {trend.velocityScore}
          </span>
          <span className="text-caption text-faint">velocity</span>
        </div>
      </div>

      <p className="text-sm text-muted">{trend.summary}</p>

      <div className="flex flex-col gap-2">
        <Tabs
          label="Angle"
          value={angle}
          onChange={setAngle}
          options={(['contrarian', 'howTo', 'predictive'] as Angle[]).map((a) => ({
            value: a,
            label: ANGLE_LABELS[a],
          }))}
        />
        <p className="rounded-xl border border-line bg-surface px-4 py-3 text-sm text-ink">
          {angleText}
        </p>
      </div>

      {trend.suggestedHooks.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <p className="text-label font-medium uppercase tracking-wide text-muted">
            Opening hooks
          </p>
          <ul className="flex flex-col gap-1">
            {trend.suggestedHooks.slice(0, 3).map((hook, i) => (
              <li key={i} className="text-sm text-muted">
                “{hook}”
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {tags.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {tags.slice(0, 8).map((tag, i) => (
            <span
              key={i}
              className="rounded-full border border-line bg-surface px-2.5 py-0.5 text-caption text-faint"
            >
              {tag}
            </span>
          ))}
        </div>
      ) : null}

      <div className="flex items-center gap-2 border-t border-line pt-4">
        <Link
          href={`/w/${workspaceId}/studio?kind=script&intent=${encodeURIComponent(useIntent)}`}
          className="flex-1"
        >
          <Button className="w-full">Launch campaign</Button>
        </Link>
        <Button
          type="button"
          variant="secondary"
          disabled={saving}
          onClick={async () => {
            setSaving(true);
            await fetch(`/api/w/${workspaceId}/trends/${trend.id}/bookmark`, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ save: !saved }),
            }).catch(() => undefined);
            setSaving(false);
            onToggleSave(trend.id, !saved);
          }}
        >
          {saved ? 'Saved' : 'Save'}
        </Button>
      </div>
      {trend.estimatedLifespan ? (
        <p className="text-caption text-faint">Estimated window: {trend.estimatedLifespan}</p>
      ) : null}
    </li>
  );
}

export function TrendsView({
  workspaceId,
  initial,
}: {
  workspaceId: string;
  initial: TrendListView & { bookmarked: Record<string, boolean> };
}) {
  const [niche, setNiche] = useState('');
  const [data, setData] = useState(initial);
  const [loading, setLoading] = useState(false);

  async function reload(nextNiche: string) {
    setLoading(true);
    const url = new URL(`/api/w/${workspaceId}/trends`, window.location.origin);
    if (nextNiche) url.searchParams.set('niche', nextNiche);
    const r = await fetch(url).catch(() => null);
    setLoading(false);
    if (!r?.ok) return;
    const body = (await r.json()) as typeof initial;
    setData(body);
  }

  return (
    <Card>
      <CardHeader
        title="Rising right now"
        note="Ingested from YouTube, search autocomplete and Reddit every few hours, then broken into angles by the same model that sharpens your prompts."
        action={
          data.niches.length > 0 ? (
            <Select
              aria-label="Niche"
              value={niche}
              onChange={(e) => {
                setNiche(e.target.value);
                void reload(e.target.value);
              }}
              className="h-10 w-48"
            >
              <option value="">All niches</option>
              {data.niches.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </Select>
          ) : null
        }
      />
      <CardBody>
        {loading ? (
          <p className="py-8 text-center text-sm text-muted">Loading…</p>
        ) : data.trends.length === 0 ? (
          <EmptyState
            title="Nothing on the radar yet"
            description="The ingestion pass runs every few hours. The first batch can take a little while to show up — come back shortly, or check a different niche."
          />
        ) : (
          <ul className="flex flex-col gap-4">
            {data.trends.map((trend) => (
              <TrendCard
                key={trend.id}
                workspaceId={workspaceId}
                trend={trend}
                saved={data.bookmarked[trend.id] ?? false}
                onToggleSave={(id, save) =>
                  setData((d) => ({ ...d, bookmarked: { ...d.bookmarked, [id]: save } }))
                }
              />
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
