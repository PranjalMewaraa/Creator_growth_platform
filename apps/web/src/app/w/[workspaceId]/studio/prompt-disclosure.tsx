'use client';

import type { CompiledPromptView, PrecedenceSource, SettingValue } from '@cgp/contracts';
import { Button, cx, Badge } from '@cgp/ui';
import { useState } from 'react';

// The PROMPT disclosure (plan section 13): the engine's compiled prompt, collapsed by default,
// readable, editable. An edit becomes a new version; the requirements come back regardless,
// because safety and platform rules outrank the user (FR-PO-06).

const HEADING = 'Requirements:';

const SOURCE: Record<PrecedenceSource, { label: string; tone: string }> = {
  safety: { label: 'Safety', tone: 'border-bad/40 text-bad' },
  platform: { label: 'Platform', tone: 'border-hot/40 text-hot' },
  user: { label: 'You', tone: 'border-accent/50 text-accent' },
  template: { label: 'Template', tone: 'border-line text-muted' },
  profile: { label: 'Profile', tone: 'border-good/40 text-good' },
};

/** Settings worth explaining; the policy text itself is shown in the requirements. */
const LABELS: Record<string, string> = {
  platform: 'Platform',
  platforms: 'Captions for',
  tone: 'Tone',
  durationSeconds: 'Length (seconds)',
  wordBudget: 'Word budget',
  aspectRatio: 'Frame',
  hashtagsMax: 'Hashtags',
  captionLimits: 'Platform limits',
  hookCount: 'Hooks',
  creator: 'Who is posting',
  pillars: 'Pillars',
  goal: 'Goal',
  prohibitedWords: 'Avoid',
  brandColours: 'Brand colours',
  tagline: 'Tagline',
  language: 'Language',
};

function show(value: SettingValue) {
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return String(value);
}

function split(text: string) {
  const at = text.indexOf(`\n\n${HEADING}`);
  if (at === -1) return { brief: text, requirements: [] as string[] };
  return {
    brief: text.slice(0, at),
    requirements: text
      .slice(at + HEADING.length + 2)
      .split('\n')
      .map((line) => line.replace(/^-\s*/, '').trim())
      .filter(Boolean),
  };
}

export function PromptDisclosure({
  workspaceId,
  prompt,
  stale,
  onEdited,
}: {
  workspaceId: string;
  prompt: CompiledPromptView;
  /** The intent or options changed since this prompt was compiled. */
  stale: boolean;
  onEdited: (prompt: CompiledPromptView) => void;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(prompt.text);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { brief, requirements } = split(prompt.text);
  const explained = prompt.settings.filter((s) => s.key in LABELS);

  async function saveEdit() {
    setSaving(true);
    setError(null);
    const response = await fetch(`/api/w/${workspaceId}/prompts/${prompt.id}/versions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: draft }),
    }).catch(() => null);
    setSaving(false);
    const body = (await response?.json().catch(() => null)) as {
      prompt?: CompiledPromptView;
      error?: { issues?: Array<{ message: string }> };
    } | null;
    if (!response?.ok || !body?.prompt) {
      setError(body?.error?.issues?.[0]?.message ?? 'The edit could not be saved.');
      return;
    }
    setEditing(false);
    onEdited(body.prompt);
  }

  return (
    // The engine's own work, so it wears the AI accent.
    <section className="ai-surface ai-glow rounded-xl">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full cursor-pointer items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <span className="flex flex-wrap items-center gap-2">
          <span className="ai-text text-subtitle font-semibold">Compiled prompt</span>
          <Badge>{prompt.fallbackUsed ? 'Standard brief' : 'Rewritten by the engine'}</Badge>
          {prompt.userEdited ? <Badge tone="accent">Edited by you</Badge> : null}
          {stale ? <Badge tone="warn">Out of date: you changed the request</Badge> : null}
        </span>
        <span className="text-label text-muted">{open ? 'Hide' : 'Show'}</span>
      </button>

      {open ? (
        <div className="flex flex-col gap-4 border-t border-white/10 px-4 py-4">
          {editing ? (
            <div className="flex flex-col gap-2">
              <textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                rows={12}
                className="w-full resize-y rounded-lg border border-line bg-surface px-3 py-2 font-mono text-[13px] leading-6 text-ink outline-none focus:border-accent/70"
              />
              <p className="text-xs text-muted">
                Your wording replaces the brief. The requirements are put back after the edit:
                safety and platform rules always apply.
              </p>
              {error ? <p className="text-sm text-bad">{error}</p> : null}
              <div className="flex gap-2">
                <Button onClick={() => void saveEdit()} disabled={saving} className="h-9">
                  {saving ? 'Saving…' : 'Use this prompt'}
                </Button>
                <Button
                  variant="quiet"
                  className="h-9"
                  onClick={() => {
                    setEditing(false);
                    setDraft(prompt.text);
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <>
              <p className="whitespace-pre-wrap text-sm leading-6 text-ink">{brief}</p>
              {requirements.length > 0 ? (
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-muted">
                    Requirements
                  </p>
                  <ul className="mt-2 flex flex-col gap-1">
                    {requirements.map((line) => (
                      <li key={line} className="flex gap-2 text-sm leading-6 text-muted">
                        <span aria-hidden className="text-faint">
                          •
                        </span>
                        {line}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <Button
                variant="secondary"
                className="h-9 w-fit"
                onClick={() => {
                  setDraft(prompt.text);
                  setEditing(true);
                }}
              >
                Edit prompt
              </Button>
            </>
          )}

          {explained.length > 0 ? (
            <details className="rounded-lg border border-line bg-surface px-3 py-2">
              <summary className="cursor-pointer text-xs text-muted">
                Why these settings · profile v{prompt.lineage.profileVersion}, brand kit v
                {prompt.lineage.brandKitVersion}, compiler v{prompt.lineage.compilerProfileVersion}
              </summary>
              <dl className="mt-2 flex flex-col gap-1.5">
                {explained.map((setting) => (
                  <div key={setting.key} className="flex items-start gap-2 text-xs">
                    <dt className="w-28 shrink-0 text-muted">{LABELS[setting.key]}</dt>
                    <dd className="min-w-0 flex-1 text-ink">
                      {show(setting.value)}
                      {setting.overridden.length > 0 ? (
                        <span className="text-faint">
                          {' '}
                          (instead of {show(setting.overridden[0]?.value ?? '')})
                        </span>
                      ) : null}
                    </dd>
                    <span
                      className={cx(
                        'shrink-0 rounded-full border px-1.5 text-[10px]',
                        SOURCE[setting.source].tone,
                      )}
                    >
                      {SOURCE[setting.source].label}
                    </span>
                  </div>
                ))}
              </dl>
            </details>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
