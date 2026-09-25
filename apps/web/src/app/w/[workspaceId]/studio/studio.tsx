'use client';

import type { CompiledPromptView, JobStatus, JobView, TargetPlatform } from '@cgp/contracts';
import { Button, cx } from '@cgp/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { artStyle } from '@/lib/art';
import { ImageOutput, OutputView, VideoOutput, type Rendition } from './output-view';
import { TemplatePicker, type TemplateCard } from './template-picker';
import { PromptDisclosure } from './prompt-disclosure';

// Studio (plan section 13, WP14): plain intent in, compiled prompt visible and editable, cost
// before submit, output streamed, and the job carries on if you leave.

export interface StudioJobSummary extends JobView {
  intentText: string;
  durationSeconds: number | null;
}

interface Output {
  id: string;
  kind: string;
  text: string;
  media: { url: string; width: number; height: number } | null;
  rendition: Rendition | null;
}

interface Kind {
  key: string;
  label: string;
  hint: string;
  /** What this generator makes, which is how its templates are found. */
  outputType: string;
  soon?: boolean;
}

const KINDS: Kind[] = [
  { key: 'script', label: 'Script', hint: 'The words to say on camera', outputType: 'script' },
  {
    key: 'hook_title_set',
    label: 'Hooks & titles',
    hint: 'Openers that stop the scroll',
    outputType: 'hook',
  },
  {
    key: 'caption_set',
    label: 'Captions',
    hint: 'One caption per platform',
    outputType: 'caption',
  },
  { key: 'image', label: 'Image', hint: 'A picture for the post', outputType: 'image' },
  {
    key: 'thumbnail_set',
    label: 'Thumbnail',
    hint: 'Three to choose between',
    outputType: 'thumbnail',
  },
  { key: 'video', label: 'Video', hint: 'Up to three eight second scenes', outputType: 'video' },
];
const LABEL: Record<string, string> = Object.fromEntries(KINDS.map((k) => [k.key, k.label]));

const PLATFORMS: Array<{ value: TargetPlatform; label: string }> = [
  { value: 'instagram', label: 'Instagram' },
  { value: 'linkedin', label: 'LinkedIn' },
];
const LENGTHS = [15, 30, 45, 60, 90];
const COUNTS = [1, 2, 3, 4];

/** Pictures are drawn, not written, so the running state says what is actually happening. */
const DRAWN: ReadonlySet<string> = new Set(['image', 'thumbnail_set', 'video']);

const TERMINAL: ReadonlySet<JobStatus> = new Set(['COMPLETE', 'BLOCKED', 'FAILED', 'CANCELLED']);

const STATUS: Record<JobStatus, { label: string; tone: string }> = {
  QUEUED: { label: 'Queued', tone: 'border-line text-muted' },
  RUNNING: { label: 'Writing', tone: 'border-accent/50 text-accent' },
  MODERATING: { label: 'Checking', tone: 'border-accent/50 text-accent' },
  COMPLETE: { label: 'Done', tone: 'border-good/50 text-good' },
  BLOCKED: { label: 'Blocked', tone: 'border-bad/50 text-bad' },
  FAILED: { label: 'Failed', tone: 'border-bad/50 text-bad' },
  CANCELLED: { label: 'Cancelled', tone: 'border-line text-muted' },
};

const REFUSALS: Record<string, string> = {
  profile_required: 'Set up your profile first: every prompt is written from it.',
  brand_kit_required: 'Save a brand kit first: every prompt uses it.',
  insufficient_credits: 'Not enough credits for this.',
  insufficient_video_seconds: 'Not enough video seconds for this.',
  moderation_unavailable: 'The safety check is unavailable right now. Try again in a moment.',
  template_not_found: 'That template is no longer available.',
  prompt_not_found: 'That prompt no longer matches this request. Compile it again.',
};

interface ApiBody {
  error?: { code?: string; category?: string; issues?: Array<{ message: string }> };
}

function refusal(body: ApiBody): string {
  const error = body.error;
  if (!error) return 'Something went wrong. Try again.';
  if (error.issues?.length) return error.issues.map((i) => i.message).join('. ');
  if (error.code === 'blocked') {
    return `The request was blocked by the safety check (${error.category ?? 'policy'}). Nothing was charged.`;
  }
  return REFUSALS[error.code ?? ''] ?? `Could not do that (${error.code}).`;
}

function ago(iso: string) {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `${hours} h ago` : `${Math.round(hours / 24)} d ago`;
}

export function Studio({
  workspaceId,
  credits,
  videoSeconds,
  ready,
  initialJobs,
  initialJobId,
  profileTone,
  brandColours,
  templates,
  art,
}: {
  workspaceId: string;
  credits: number;
  /** Video is paid in seconds, never in credits (plan section 7). */
  videoSeconds: number;
  ready: { profile: boolean; brandKit: boolean };
  initialJobs: StudioJobSummary[];
  initialJobId: string | null;
  profileTone: string | null;
  /** The brand kit's colours, offered first when a text layer is coloured. */
  brandColours: string[];
  /** Every template with its real preview and price (WP19). */
  templates: TemplateCard[];
  /** Card art from public/art, for the generator tiles. */
  art: string[];
}) {
  const router = useRouter();
  const base = `/api/w/${workspaceId}`;

  const [kind, setKind] = useState('script');
  const [intent, setIntent] = useState('');
  const [platform, setPlatform] = useState<TargetPlatform | null>('instagram');
  const [captionFor, setCaptionFor] = useState<TargetPlatform[]>([]);
  const [length, setLength] = useState<number | null>(null);
  const [count, setCount] = useState(1);
  const [sceneCount, setSceneCount] = useState(3);
  const [tone, setTone] = useState('');
  const [templateId, setTemplateId] = useState<string | null>(null);
  // The templates for what is being made, plain one first, since that is the default.
  const outputType = KINDS.find((k) => k.key === kind)?.outputType;
  const kindTemplates = templates
    .filter((template) => template.outputType === outputType)
    .sort((a, b) => Number(b.slug.startsWith('default-')) - Number(a.slug.startsWith('default-')));

  const [cost, setCost] = useState<{ credits: number; videoSeconds: number } | null>(null);
  const [prompt, setPrompt] = useState<CompiledPromptView | null>(null);
  const [promptFor, setPromptFor] = useState<string | null>(null);
  const [busy, setBusy] = useState<'compiling' | 'starting' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [jobs, setJobs] = useState(initialJobs);
  const [job, setJob] = useState<JobView | null>(null);
  const [jobIntent, setJobIntent] = useState('');
  const [streamed, setStreamed] = useState('');
  const [outputs, setOutputs] = useState<Output[]>([]);
  const opened = useRef(false);

  const input = {
    intentText: intent.trim(),
    targetPlatform: platform,
    ...(tone.trim() ? { tone: tone.trim() } : {}),
    ...(kind === 'script' && length ? { durationSeconds: length } : {}),
    ...(kind === 'image' ? { count } : {}),
    ...(kind === 'video' ? { sceneCount } : {}),
    ...(templateId ? { templateId } : {}),
    ...(kind === 'caption_set' && captionFor.length ? { platforms: captionFor } : {}),
  };
  const requestKey = JSON.stringify({ kind, input });
  const stale = prompt !== null && promptFor !== requestKey && !prompt.userEdited;
  const blocked = !ready.profile || !ready.brandKit;
  const canGo = busy === null && input.intentText.length > 0 && !blocked;

  // Cost before submit: priced by the server against the rates in force.
  useEffect(() => {
    if (!input.intentText) return;
    const timer = setTimeout(() => {
      void fetch(`${base}/generate/${kind}/estimate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      })
        .then(async (r) =>
          r.ok
            ? ((await r.json()) as { estimate: { credits: number; videoSeconds?: number } })
            : null,
        )
        .then((body) =>
          setCost(
            body
              ? { credits: body.estimate.credits, videoSeconds: body.estimate.videoSeconds ?? 0 }
              : null,
          ),
        )
        .catch(() => setCost(null));
    }, 300);
    return () => clearTimeout(timer);
    // requestKey captures every field of the input.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, requestKey]);

  const refreshJobs = useCallback(async () => {
    const r = await fetch(`${base}/jobs`).catch(() => null);
    if (r?.ok) setJobs(((await r.json()) as { jobs: StudioJobSummary[] }).jobs);
  }, [base]);

  const loadOutputs = useCallback(
    async (jobId: string) => {
      const r = await fetch(`${base}/jobs/${jobId}/outputs`).catch(() => null);
      if (r?.ok) setOutputs(((await r.json()) as { outputs: Output[] }).outputs);
    },
    [base],
  );

  // Follow the open job: status from Postgres, text as it streams. Leaving the page does not
  // stop the job; coming back reopens it from the URL or the recent list.
  const jobId = job?.id;
  const jobDone = job ? TERMINAL.has(job.status) : true;
  useEffect(() => {
    if (!jobId || jobDone) return;
    const events = new EventSource(`${base}/jobs/${jobId}/events`);
    events.addEventListener('delta', (e) => {
      const { text } = JSON.parse((e as MessageEvent<string>).data) as { text: string };
      setStreamed((s) => s + text);
    });
    events.addEventListener('status', (e) => {
      const next = (JSON.parse((e as MessageEvent<string>).data) as { job: JobView }).job;
      setJob(next);
      if (TERMINAL.has(next.status)) {
        events.close();
        if (next.status === 'COMPLETE') void loadOutputs(next.id);
        void refreshJobs();
        router.refresh();
      }
    });
    return () => events.close();
  }, [base, jobId, jobDone, loadOutputs, refreshJobs, router]);

  const openJob = useCallback(
    async (id: string) => {
      setError(null);
      setStreamed('');
      setOutputs([]);
      const r = await fetch(`${base}/jobs/${id}`).catch(() => null);
      if (!r?.ok) return;
      const { job: view } = (await r.json()) as { job: JobView };
      setJob(view);
      setJobIntent(jobs.find((j) => j.id === id)?.intentText ?? '');
      if (view.status === 'COMPLETE') void loadOutputs(id);
      window.history.replaceState(null, '', `?job=${id}`);
    },
    [base, jobs, loadOutputs],
  );

  // Reopen the job named in the URL once, on arrival.
  useEffect(() => {
    if (opened.current || !initialJobId) return;
    opened.current = true;
    void openJob(initialJobId);
  }, [initialJobId, openJob]);

  async function compile() {
    setBusy('compiling');
    setError(null);
    const r = await fetch(`${base}/generate/${kind}/compile`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    }).catch(() => null);
    setBusy(null);
    const body = (await r?.json().catch(() => ({}))) as ApiBody & { prompt?: CompiledPromptView };
    if (!r?.ok || !body.prompt) return setError(refusal(body ?? {}));
    setPrompt(body.prompt);
    setPromptFor(requestKey);
  }

  async function generate() {
    setBusy('starting');
    setError(null);
    const usePrompt = prompt && !stale ? prompt.id : undefined;
    const r = await fetch(`${base}/generate/${kind}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...input, ...(usePrompt ? { compiledPromptId: usePrompt } : {}) }),
    }).catch(() => null);
    setBusy(null);
    const body = (await r?.json().catch(() => ({}))) as ApiBody & {
      job?: JobView;
      prompt?: CompiledPromptView;
    };
    if (!r?.ok || !body.job) return setError(refusal(body ?? {}));
    if (body.prompt) {
      setPrompt(body.prompt);
      setPromptFor(requestKey);
    }
    setStreamed('');
    setOutputs([]);
    setJob(body.job);
    setJobIntent(input.intentText);
    window.history.replaceState(null, '', `?job=${body.job.id}`);
    void refreshJobs();
    router.refresh();
  }

  const checking = job !== null && !TERMINAL.has(job.status);
  // The recent list knows every job's intent, so it survives a refresh or a return visit.
  const openJobRow = job ? jobs.find((j) => j.id === job.id) : undefined;
  const shownIntent = openJobRow?.intentText || jobIntent;
  // The length that job asked for, which the script meter measures the result against.
  const shownDuration = openJobRow?.durationSeconds ?? null;
  const credit = (n: number) => `${n} ${n === 1 ? 'credit' : 'credits'}`;

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,44fr)_minmax(0,56fr)]">
      {/* Left: the request. */}
      <section className="flex flex-col rounded-2xl border border-line bg-surface">
        <header className="px-6 pt-5">
          <h1 className="text-xl font-semibold tracking-tight text-ink">Studio</h1>
          <p className="mt-1 text-sm text-muted">
            Say what you want in plain words. The engine writes the full prompt from your profile
            and brand kit.
          </p>
        </header>

        {blocked ? (
          <div className="mx-6 mt-4 rounded-xl border border-accent/40 bg-accent/5 px-4 py-3 text-sm text-ink">
            {!ready.profile
              ? 'Answer the profile questions first; every prompt is written from them.'
              : 'Save a brand kit first; every prompt uses it.'}{' '}
            <Link
              href={`/w/${workspaceId}/${ready.profile ? 'brand' : 'onboarding'}`}
              className="text-accent hover:underline"
            >
              {ready.profile ? 'Open Brand' : 'Start'}
            </Link>
          </div>
        ) : null}

        <div className="flex flex-col gap-5 px-6 py-5">
          <div className="grid grid-cols-3 gap-2">
            {KINDS.map((k, i) => (
              <button
                key={k.key}
                type="button"
                disabled={k.soon}
                aria-pressed={kind === k.key}
                onClick={() => {
                  setKind(k.key);
                  // Templates belong to one output type, so the choice does not carry over.
                  setTemplateId(null);
                }}
                title={k.hint}
                className={cx(
                  'relative flex h-24 flex-col justify-end overflow-hidden rounded-xl border p-2.5 text-left transition',
                  kind === k.key
                    ? 'border-accent ring-2 ring-accent/40'
                    : 'border-line hover:-translate-y-0.5 hover:border-faint',
                  k.soon && 'cursor-not-allowed grayscale hover:translate-y-0 hover:border-line',
                )}
                style={artStyle(i, art)}
              >
                {/* Keeps the label readable on any art. */}
                <span
                  aria-hidden
                  className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/30 to-transparent"
                />
                {k.soon ? (
                  <span className="absolute right-2 top-2 rounded-full bg-black/60 px-2 py-0.5 text-[10px] uppercase tracking-wide text-white/80">
                    Soon
                  </span>
                ) : null}
                <span className="relative text-sm font-semibold text-white">{k.label}</span>
                <span className="relative text-[11px] leading-4 text-white/75">{k.hint}</span>
              </button>
            ))}
          </div>

          <TemplatePicker
            templates={kindTemplates}
            selected={templateId}
            onSelect={setTemplateId}
          />

          <div className="flex flex-col gap-2">
            <label
              htmlFor="studio-intent"
              className="text-xs font-medium uppercase tracking-wide text-muted"
            >
              What do you want?
            </label>
            <textarea
              id="studio-intent"
              value={intent}
              onChange={(event) => setIntent(event.target.value)}
              rows={4}
              maxLength={2000}
              placeholder="e.g. Our cold brew now ships across Jaipur"
              className="w-full resize-y rounded-xl border border-line bg-raised px-4 py-3 text-[15px] leading-6 text-ink outline-none transition placeholder:text-faint focus:border-accent/70 focus:ring-2 focus:ring-accent/15"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <span className="text-xs font-medium uppercase tracking-wide text-muted">For</span>
              <div className="flex flex-wrap gap-1.5">
                {[...PLATFORMS, { value: null, label: 'Anywhere' }].map((p) => (
                  <button
                    key={p.label}
                    type="button"
                    aria-pressed={platform === p.value}
                    onClick={() => setPlatform(p.value)}
                    className={cx(
                      'rounded-full border px-3 py-1.5 text-sm transition',
                      platform === p.value
                        ? 'border-accent bg-accent/10 text-ink'
                        : 'border-line bg-raised text-muted hover:text-ink',
                    )}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            {kind === 'script' ? (
              <div className="flex flex-col gap-2">
                <span className="text-xs font-medium uppercase tracking-wide text-muted">
                  Length
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {[null, ...LENGTHS].map((l) => (
                    <button
                      key={String(l)}
                      type="button"
                      aria-pressed={length === l}
                      onClick={() => setLength(l)}
                      className={cx(
                        'rounded-full border px-3 py-1.5 text-sm transition',
                        length === l
                          ? 'border-accent bg-accent/10 text-ink'
                          : 'border-line bg-raised text-muted hover:text-ink',
                      )}
                    >
                      {l ? `${l}s` : 'Default'}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {kind === 'image' ? (
              <div className="flex flex-col gap-2">
                <span className="text-xs font-medium uppercase tracking-wide text-muted">
                  How many
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {COUNTS.map((n) => (
                    <button
                      key={n}
                      type="button"
                      aria-pressed={count === n}
                      onClick={() => setCount(n)}
                      className={cx(
                        'rounded-full border px-3 py-1.5 text-sm transition',
                        count === n
                          ? 'border-accent bg-accent/10 text-ink'
                          : 'border-line bg-raised text-muted hover:text-ink',
                      )}
                    >
                      {n}
                    </button>
                  ))}
                </div>
                <span className="text-[11px] text-muted">Each one costs its own credits.</span>
              </div>
            ) : null}

            {kind === 'video' ? (
              <div className="flex flex-col gap-2">
                <span className="text-xs font-medium uppercase tracking-wide text-muted">
                  Scenes
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {[1, 2, 3].map((n) => (
                    <button
                      key={n}
                      type="button"
                      aria-pressed={sceneCount === n}
                      onClick={() => setSceneCount(n)}
                      className={cx(
                        'rounded-full border px-3 py-1.5 text-sm transition',
                        sceneCount === n
                          ? 'border-accent bg-accent/10 text-ink'
                          : 'border-line bg-raised text-muted hover:text-ink',
                      )}
                    >
                      {n}
                    </button>
                  ))}
                </div>
                <span className="text-[11px] text-muted">
                  Eight seconds each, so {sceneCount * 8}s in all. No voiceover or captions yet.
                </span>
              </div>
            ) : null}

            {kind === 'caption_set' ? (
              <div className="flex flex-col gap-2">
                <span className="text-xs font-medium uppercase tracking-wide text-muted">
                  Captions for
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {PLATFORMS.map((p) => {
                    const on = captionFor.includes(p.value);
                    return (
                      <button
                        key={p.value}
                        type="button"
                        aria-pressed={on}
                        onClick={() =>
                          setCaptionFor((list) =>
                            on ? list.filter((v) => v !== p.value) : [...list, p.value],
                          )
                        }
                        className={cx(
                          'rounded-full border px-3 py-1.5 text-sm transition',
                          on
                            ? 'border-accent bg-accent/10 text-ink'
                            : 'border-line bg-raised text-muted hover:text-ink',
                        )}
                      >
                        {p.label}
                      </button>
                    );
                  })}
                </div>
                <span className="text-[11px] text-muted">
                  None picked: the platform on the left.
                </span>
              </div>
            ) : null}
          </div>

          <div className="flex flex-col gap-2">
            <label
              htmlFor="studio-tone"
              className="text-xs font-medium uppercase tracking-wide text-muted"
            >
              Tone for this one <span className="normal-case text-faint">(optional)</span>
            </label>
            <input
              id="studio-tone"
              value={tone}
              onChange={(event) => setTone(event.target.value)}
              maxLength={80}
              placeholder={profileTone ? `Your usual: ${profileTone}` : 'Your profile tone'}
              className="h-11 w-full rounded-xl border border-line bg-raised px-4 text-sm text-ink outline-none transition placeholder:text-faint focus:border-accent/70 focus:ring-2 focus:ring-accent/15"
            />
          </div>

          {prompt ? (
            <PromptDisclosure
              key={prompt.id}
              workspaceId={workspaceId}
              prompt={prompt}
              stale={stale}
              onEdited={(edited) => {
                setPrompt(edited);
                setPromptFor(requestKey);
              }}
            />
          ) : null}
        </div>

        <footer className="sticky bottom-0 flex flex-col gap-3 rounded-b-2xl border-t border-line bg-surface/95 px-6 py-4 backdrop-blur">
          {error ? <p className="text-sm text-bad">{error}</p> : null}
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="text-muted">
              {input.intentText && cost !== null ? (
                <>
                  Costs{' '}
                  <span className="font-semibold text-ink">
                    {cost.videoSeconds > 0
                      ? `${cost.videoSeconds}s of video`
                      : credit(cost.credits)}
                  </span>
                </>
              ) : (
                'Cost shows once you describe it'
              )}
            </span>
            <span className="text-muted">
              Balance{' '}
              <span className="tabular-nums text-ink">
                {cost?.videoSeconds
                  ? `${videoSeconds.toLocaleString('en-IN')}s`
                  : credits.toLocaleString('en-IN')}
              </span>
            </span>
          </div>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              onClick={() => void compile()}
              disabled={!canGo}
              className="flex-1"
            >
              {busy === 'compiling'
                ? 'Writing prompt…'
                : prompt && !stale
                  ? 'Rewrite prompt'
                  : 'See the prompt'}
            </Button>
            <Button onClick={() => void generate()} disabled={!canGo} className="flex-1">
              {busy === 'starting' ? 'Starting…' : 'Generate'}
            </Button>
          </div>
          <p className="text-[11px] text-muted">
            Writing the prompt is free. Credits are held when you generate, charged when it is done,
            and refunded in full if it fails or is blocked.
          </p>
        </footer>
      </section>

      {/* Right: the output, then what was made before. */}
      <aside className="flex flex-col gap-4 lg:sticky lg:top-20">
        <section className="flex min-h-[360px] flex-col gap-4 rounded-2xl border border-line bg-surface p-5">
          {job ? (
            <>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-ink">
                    {LABEL[job.generatorKey] ?? job.generatorKey}
                  </p>
                  {shownIntent ? (
                    <p className="truncate text-xs text-muted">{shownIntent}</p>
                  ) : null}
                </div>
                <span
                  className={cx('rounded-full border px-3 py-1 text-xs', STATUS[job.status].tone)}
                >
                  {checking && job.status !== 'QUEUED' ? 'Checking · ' : ''}
                  {job.status === 'RUNNING' && job.generatorKey === 'video'
                    ? 'Filming'
                    : job.status === 'RUNNING' && DRAWN.has(job.generatorKey)
                      ? 'Drawing'
                      : STATUS[job.status].label}
                </span>
              </div>

              <p className="text-xs text-muted">
                {job.held.videoSeconds > 0
                  ? job.status === 'COMPLETE'
                    ? `${job.settled?.videoSeconds ?? job.held.videoSeconds}s of video charged.`
                    : TERMINAL.has(job.status)
                      ? `${job.held.videoSeconds}s refunded in full.`
                      : `${job.held.videoSeconds}s held until it is done.`
                  : job.status === 'COMPLETE'
                    ? `${credit(job.settled?.credits ?? job.held.credits)} charged.`
                    : TERMINAL.has(job.status)
                      ? `${credit(job.held.credits)} refunded in full.`
                      : `${credit(job.held.credits)} held until it is done.`}
              </p>

              {job.error ? (
                <p className="rounded-lg border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-ink">
                  {job.status === 'BLOCKED'
                    ? `Blocked by the safety check${job.error.category ? ` (${job.error.category})` : ''}. Nothing was charged.`
                    : job.error.code === 'MODERATION_UNAVAILABLE'
                      ? 'The safety check was unavailable, so this was not released. Nothing was charged; try again.'
                      : 'This one did not work. Nothing was charged; try again.'}
                </p>
              ) : null}

              {outputs.length > 0 ? (
                outputs[0]?.kind === 'video' && outputs[0].media ? (
                  <VideoOutput {...outputs[0].media} />
                ) : outputs[0]?.media ? (
                  <div className={cx('grid gap-3', outputs.length > 1 && 'sm:grid-cols-2')}>
                    {outputs.map((output) =>
                      output.media ? (
                        <ImageOutput
                          key={output.id}
                          workspaceId={workspaceId}
                          outputId={output.id}
                          brandColours={brandColours}
                          rendition={output.rendition}
                          {...output.media}
                        />
                      ) : null,
                    )}
                  </div>
                ) : (
                  outputs.map((output) => (
                    <OutputView
                      key={output.id}
                      kind={output.kind}
                      text={output.text}
                      locked={false}
                      targetSeconds={shownDuration}
                      workspaceId={workspaceId}
                      outputId={output.id}
                    />
                  ))
                )
              ) : /* A blocked or failed job releases nothing: what streamed is replaced by
                    the refusal above, never left on screen (plan section 14). */
              streamed && (!TERMINAL.has(job.status) || job.status === 'COMPLETE') ? (
                <div className="flex flex-col gap-2">
                  <p className="text-xs text-muted">
                    {job.status === 'COMPLETE'
                      ? 'Loading the finished result…'
                      : 'Writing… copy unlocks once it is checked.'}
                  </p>
                  <p className="whitespace-pre-wrap rounded-xl border border-line bg-raised px-4 py-3 text-[15px] leading-7 text-ink/80">
                    {streamed}
                  </p>
                </div>
              ) : checking ? (
                <p className="text-sm text-muted">
                  {job.generatorKey === 'video'
                    ? 'Filming scene by scene, then joining them. Minutes, not seconds.'
                    : DRAWN.has(job.generatorKey)
                      ? 'Drawing it now; pictures arrive all at once.'
                      : 'Waiting for the first words…'}
                </p>
              ) : job.status === 'COMPLETE' ? (
                <p className="text-sm text-muted">Loading the result…</p>
              ) : null}
            </>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
              <p className="text-sm font-medium text-ink">Nothing yet</p>
              <p className="max-w-xs text-sm text-muted">
                What you generate appears here as it is written. You can leave; it keeps going.
              </p>
            </div>
          )}
        </section>

        {jobs.length > 0 ? (
          <section className="rounded-2xl border border-line bg-surface p-5">
            <h2 className="text-sm font-medium text-ink">Recent</h2>
            <ul className="mt-3 flex flex-col gap-1.5">
              {jobs.map((j) => (
                <li key={j.id}>
                  <button
                    type="button"
                    onClick={() => void openJob(j.id)}
                    className={cx(
                      'flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition hover:bg-raised',
                      job?.id === j.id && 'bg-raised',
                    )}
                  >
                    <span className="w-24 shrink-0 text-xs text-muted">
                      {LABEL[j.generatorKey] ?? j.generatorKey}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm text-ink">
                      {j.intentText || '—'}
                    </span>
                    <span
                      className={cx(
                        'rounded-full border px-2 py-0.5 text-[11px]',
                        STATUS[j.status].tone,
                      )}
                    >
                      {STATUS[j.status].label}
                    </span>
                    <span className="w-16 shrink-0 text-right text-[11px] text-muted">
                      {ago(j.createdAt)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </aside>
    </div>
  );
}
