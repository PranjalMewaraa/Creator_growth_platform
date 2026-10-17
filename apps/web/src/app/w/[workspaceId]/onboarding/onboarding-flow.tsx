'use client';

import type { ProfileInput } from '@cgp/core';
import { Button, cx, Progress, useToast } from '@cgp/ui';
import { useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { BriefPreview, ChoiceField, TagsField, TextField } from '@/components/profile-fields';
import { briefLines } from '@/lib/profile-brief';
import { saveProfileAction } from '../profile-actions';

type Key = Exclude<keyof ProfileInput, 'language'>;

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

interface Step {
  key: Key;
  question: string;
  help: string;
  /** What the answer changes, said plainly beside the brief. */
  effect: string;
  optional?: boolean;
}

const STEPS: Step[] = [
  {
    key: 'contentTypes',
    question: 'What do you make?',
    help: 'Pick everything you post. You can add your own.',
    effect: 'The brief says what you make, so the writing fits the format.',
  },
  {
    key: 'platforms',
    question: 'Where do you post?',
    help: 'Each platform brings its own limits and image frames.',
    effect:
      'Where you publish. Each platform’s own length limits and image frames apply to posts there.',
  },
  {
    key: 'teamShape',
    question: 'Who is behind it?',
    help: 'So the writing sounds like the right number of people.',
    effect: 'The brief says who is posting, so the voice fits one person or a team.',
  },
  {
    key: 'pillars',
    question: 'What do you keep coming back to?',
    help: 'Three to five themes, your content pillars.',
    effect: 'Every brief names them, and they become hashtag suggestions in Create post.',
  },
  {
    key: 'goal90d',
    question: 'What do you want from the next 90 days?',
    help: 'One goal is plenty. Be specific.',
    effect:
      'The brief says what you are working towards, so hooks and calls to action can serve it.',
  },
  {
    key: 'cadence',
    question: 'How often do you want to post?',
    help: 'Be honest; a steady rhythm beats a big plan.',
    effect:
      'Your posting rhythm, for planning the calendar once it arrives. It does not change the writing.',
  },
  {
    key: 'tone',
    question: 'How should it sound?',
    help: 'Pick one or write it in your own words.',
    effect: 'Applied to everything generated, unless you ask for a different tone on a post.',
  },
  {
    key: 'prohibitedWords',
    question: 'Any words to never use?',
    help: 'Optional. Brand no-gos, overused words, competitor names.',
    effect: 'Every prompt forbids them.',
    optional: true,
  },
];

const EMPTY: ProfileInput = {
  contentTypes: [],
  platforms: [],
  teamShape: '',
  goal90d: '',
  cadence: '',
  pillars: [],
  tone: '',
  prohibitedWords: [],
  language: 'en',
};

function answered(profile: ProfileInput, step: Step): boolean {
  if (step.optional) return true;
  const value = profile[step.key];
  return Array.isArray(value) ? value.length > 0 : value.trim().length > 0;
}

export function OnboardingFlow({
  workspaceId,
  workspaceName,
  options,
  initial,
}: {
  workspaceId: string;
  workspaceName: string;
  options: Options;
  /** The current profile when re-running onboarding, else nothing. */
  initial: ProfileInput | null;
}) {
  const router = useRouter();
  const toast = useToast();
  const [profile, setProfile] = useState<ProfileInput>(initial ?? EMPTY);
  const [index, setIndex] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reviewing = index === STEPS.length;
  const step = STEPS[index];
  const set = <K extends Key>(key: K, value: ProfileInput[K]) =>
    setProfile((current) => ({ ...current, [key]: value }));

  async function save() {
    setSaving(true);
    setError(null);
    const result = await saveProfileAction(workspaceId, profile).catch(() => null);
    setSaving(false);
    if (!result) return setError('Could not save. Check your connection and try again.');
    if (!result.ok) return setError(result.issues.map((i) => i.message).join('. '));
    toast({
      tone: 'good',
      message: `Profile saved as version ${result.version}. Every prompt uses it from now on.`,
    });
    // First time through, Home is where the thread continues: its card knows which of the
    // four steps is next (WP48). Someone re-running onboarding to correct an answer came
    // from the Brand screen and wants to see the version they just made, so send them back.
    router.push(initial ? `/w/${workspaceId}/brand?saved=${result.version}` : `/w/${workspaceId}`);
  }

  function field(current: Step): ReactNode {
    switch (current.key) {
      case 'contentTypes':
        return (
          <TagsField
            label={current.question}
            options={options.contentTypes}
            value={profile.contentTypes}
            onChange={(v) => set('contentTypes', v)}
            placeholder="Something else? Type it and press Enter"
            max={6}
          />
        );
      case 'platforms':
        return (
          <div className="flex flex-wrap gap-3">
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
                    'flex h-14 min-w-44 items-center gap-3 rounded-2xl border px-4 text-base transition',
                    on
                      ? 'border-accent bg-accent/10 text-ink'
                      : 'border-line bg-raised text-muted hover:border-faint hover:text-ink',
                  )}
                >
                  <span
                    className={cx(
                      'grid size-6 place-items-center rounded-full border text-xs',
                      on ? 'border-accent bg-accent text-accent-ink' : 'border-faint',
                    )}
                  >
                    {on ? '✓' : ''}
                  </span>
                  {label}
                </button>
              );
            })}
          </div>
        );
      case 'teamShape':
        return (
          <ChoiceField
            label={current.question}
            options={options.teamShapes}
            value={profile.teamShape}
            onChange={(v) => set('teamShape', v)}
            placeholder="Or describe it yourself"
          />
        );
      case 'pillars':
        return (
          <TagsField
            label={current.question}
            value={profile.pillars}
            onChange={(v) => set('pillars', v)}
            placeholder="e.g. How to, Behind the scenes, Customer stories"
            max={5}
          />
        );
      case 'goal90d':
        return (
          <TextField
            label={current.question}
            value={profile.goal90d}
            onChange={(v) => set('goal90d', v)}
            placeholder="What would make the next three months a success?"
            examples={['Reach 10k followers', 'Get 50 enquiries a month', 'Launch the new range']}
            max={200}
          />
        );
      case 'cadence':
        return (
          <ChoiceField
            label={current.question}
            options={options.cadences}
            value={profile.cadence}
            onChange={(v) => set('cadence', v)}
            placeholder="Or your own rhythm"
          />
        );
      case 'tone':
        return (
          <ChoiceField
            label={current.question}
            options={options.tones}
            value={profile.tone}
            onChange={(v) => set('tone', v)}
            placeholder="Or in your own words"
          />
        );
      case 'prohibitedWords':
        return (
          <TagsField
            label={current.question}
            value={profile.prohibitedWords}
            onChange={(v) => set('prohibitedWords', v)}
            placeholder="Type a word and press Enter"
            max={30}
          />
        );
    }
  }

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
      <section className="flex min-h-[520px] flex-col rounded-2xl border border-line bg-surface">
        <div className="px-6 pt-6 sm:px-8">
          <div className="flex items-center justify-between text-xs text-muted">
            <span>Setting up {workspaceName}</span>
            <span>{reviewing ? 'Review' : `Question ${index + 1} of ${STEPS.length}`}</span>
          </div>
          <Progress
            className="mt-3"
            label={`Question ${Math.min(index + 1, STEPS.length)} of ${STEPS.length}`}
            value={Math.min(index, STEPS.length)}
            max={STEPS.length}
          />
        </div>

        <div className="flex flex-1 flex-col gap-6 px-6 py-8 sm:px-8">
          {step && !reviewing ? (
            <>
              <div>
                <h1 className="font-display text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
                  {step.question}
                </h1>
                <p className="mt-2 text-sm text-muted">{step.help}</p>
              </div>
              {field(step)}
            </>
          ) : (
            <>
              <div>
                <h1 className="font-display text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
                  Looks right?
                </h1>
                <p className="mt-2 text-sm text-muted">
                  {initial
                    ? 'Saving adds a new version of your profile.'
                    : 'Saving creates your profile.'}{' '}
                  Every generation from then on uses it, and you can correct it any time.
                </p>
              </div>
              <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-[auto_1fr]">
                {STEPS.map((s, i) => {
                  const value = profile[s.key];
                  const shown = Array.isArray(value)
                    ? value.map((v) => PLATFORMS.find((p) => p.value === v)?.label ?? v).join(', ')
                    : value;
                  return (
                    <div key={s.key} className="contents">
                      <dt className="text-sm text-muted">{s.question}</dt>
                      <dd className="flex items-start justify-between gap-3 text-sm text-ink">
                        <span>{shown || <span className="text-faint">Nothing</span>}</span>
                        <button
                          type="button"
                          onClick={() => setIndex(i)}
                          className="tap-target shrink-0 cursor-pointer text-xs text-accent hover:underline"
                        >
                          Change
                        </button>
                      </dd>
                    </div>
                  );
                })}
              </dl>
            </>
          )}
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-line px-6 py-4 sm:px-8">
          <Button
            variant="quiet"
            onClick={() => setIndex((i) => Math.max(0, i - 1))}
            disabled={index === 0}
          >
            Back
          </Button>
          <div className="flex items-center gap-3">
            {error ? <p className="text-sm text-bad">{error}</p> : null}
            {reviewing ? (
              <Button onClick={() => void save()} disabled={saving} className="min-w-36">
                {saving ? 'Saving…' : 'Save profile'}
              </Button>
            ) : (
              <Button
                onClick={() => setIndex((i) => i + 1)}
                disabled={!step || !answered(profile, step)}
                className="min-w-36"
              >
                {step?.optional && profile.prohibitedWords.length === 0 ? 'Skip' : 'Continue'}
              </Button>
            )}
          </div>
        </footer>
      </section>

      <aside className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-6 lg:sticky lg:top-20">
        <div>
          <h2 className="text-sm font-medium text-ink">What this sets up</h2>
          <p className="mt-1 text-xs text-muted">
            These lines go into every prompt the engine writes for this workspace.
          </p>
        </div>
        <div className="rounded-xl border border-line bg-canvas p-3">
          <BriefPreview lines={briefLines(profile)} highlight={step?.key} />
        </div>
        {step && !reviewing ? (
          <p className="rounded-lg border border-accent/30 bg-accent/5 px-3 py-2 text-sm text-ink">
            {step.effect}
          </p>
        ) : null}
      </aside>
    </div>
  );
}
