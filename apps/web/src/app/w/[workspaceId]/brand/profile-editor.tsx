'use client';

import type { ProfileInput } from '@cgp/core';
import { Button, cx } from '@cgp/ui';
import { useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { BriefPreview, ChoiceField, TagsField, TextField } from '@/components/profile-fields';
import { briefLines } from '@/lib/profile-brief';
import { saveProfileAction } from '../profile-actions';

interface Options {
  contentTypes: readonly string[];
  teamShapes: readonly string[];
  cadences: readonly string[];
  tones: readonly string[];
}

const PLATFORMS = [
  { value: 'instagram', label: 'Instagram' },
  { value: 'linkedin', label: 'LinkedIn' },
] as const;

function Section({ title, hint, children }: { title: string; hint: string; children: ReactNode }) {
  return (
    <div className="grid gap-3 border-t border-line py-5 first:border-t-0 first:pt-0 md:grid-cols-[200px_minmax(0,1fr)] md:gap-6">
      <div>
        <h3 className="text-sm font-medium text-ink">{title}</h3>
        <p className="mt-1 text-xs text-muted">{hint}</p>
      </div>
      <div>{children}</div>
    </div>
  );
}

/** S-17: structured fields; saving a correction adds version N+1. */
export function ProfileEditor({
  workspaceId,
  options,
  current,
  version,
}: {
  workspaceId: string;
  options: Options;
  current: ProfileInput;
  version: number;
}) {
  const router = useRouter();
  const [profile, setProfile] = useState(current);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: 'good' | 'bad'; text: string } | null>(null);
  const dirty = JSON.stringify(profile) !== JSON.stringify(current);

  const set = <K extends keyof ProfileInput>(key: K, value: ProfileInput[K]) => {
    setProfile((p) => ({ ...p, [key]: value }));
    setMessage(null);
  };

  async function save() {
    setSaving(true);
    const result = await saveProfileAction(workspaceId, profile).catch(() => null);
    setSaving(false);
    if (!result) return setMessage({ tone: 'bad', text: 'Could not save. Try again.' });
    if (!result.ok) {
      return setMessage({ tone: 'bad', text: result.issues.map((i) => i.message).join('. ') });
    }
    if (!result.changed) return setMessage({ tone: 'good', text: 'Nothing changed.' });
    // The page confirms the new version and remounts this form from it.
    router.replace(`/w/${workspaceId}/brand?saved=${result.version}`, { scroll: false });
  }

  return (
    <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="flex flex-col">
        <Section title="What you make" hint="Formats you post.">
          <TagsField
            options={options.contentTypes}
            value={profile.contentTypes}
            onChange={(v) => set('contentTypes', v)}
            placeholder="Add your own"
            max={6}
          />
        </Section>
        <Section title="Where you post" hint="Each has its own limits and frames.">
          <div className="flex flex-wrap gap-2">
            {PLATFORMS.map(({ value, label }) => {
              const on = profile.platforms.includes(value);
              return (
                <button
                  key={value}
                  type="button"
                  aria-pressed={on}
                  onClick={() =>
                    set(
                      'platforms',
                      on
                        ? profile.platforms.filter((p) => p !== value)
                        : [...profile.platforms, value],
                    )
                  }
                  className={cx(
                    'rounded-full border px-3.5 py-2 text-sm transition',
                    on
                      ? 'border-accent bg-accent/10 text-ink'
                      : 'border-line bg-raised text-muted hover:text-ink',
                  )}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </Section>
        <Section title="Who is posting" hint="One person or a team.">
          <ChoiceField
            options={options.teamShapes}
            value={profile.teamShape}
            onChange={(v) => set('teamShape', v)}
            placeholder="Or describe it yourself"
          />
        </Section>
        <Section title="Content pillars" hint="Three to five themes. Also hashtag suggestions.">
          <TagsField
            value={profile.pillars}
            onChange={(v) => set('pillars', v)}
            placeholder="Add a pillar"
            max={5}
          />
        </Section>
        <Section title="90 day goal" hint="What the content is working towards.">
          <TextField
            value={profile.goal90d}
            onChange={(v) => set('goal90d', v)}
            placeholder="Your goal"
            max={200}
          />
        </Section>
        <Section title="Cadence" hint="Your posting rhythm.">
          <ChoiceField
            options={options.cadences}
            value={profile.cadence}
            onChange={(v) => set('cadence', v)}
            placeholder="Or your own rhythm"
          />
        </Section>
        <Section title="Tone" hint="How everything should sound.">
          <ChoiceField
            options={options.tones}
            value={profile.tone}
            onChange={(v) => set('tone', v)}
            placeholder="Or in your own words"
          />
        </Section>
        <Section title="Words to avoid" hint="Every prompt forbids them.">
          <TagsField
            value={profile.prohibitedWords}
            onChange={(v) => set('prohibitedWords', v)}
            placeholder="Add a word"
            max={30}
          />
        </Section>
      </div>

      <div className="flex flex-col gap-4 xl:sticky xl:top-20">
        <div className="rounded-xl border border-line bg-canvas p-3">
          <p className="mb-2 px-2 text-xs text-muted">In every prompt</p>
          <BriefPreview lines={briefLines(profile)} />
        </div>
        <div className="flex flex-col gap-2">
          <Button onClick={() => void save()} disabled={!dirty || saving} className="w-full">
            {saving ? 'Saving…' : dirty ? `Save as version ${version + 1}` : 'No changes'}
          </Button>
          {dirty ? (
            <Button variant="quiet" onClick={() => setProfile(current)} className="w-full">
              Discard changes
            </Button>
          ) : null}
          {message ? (
            <p className={cx('text-sm', message.tone === 'good' ? 'text-good' : 'text-bad')}>
              {message.text}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
