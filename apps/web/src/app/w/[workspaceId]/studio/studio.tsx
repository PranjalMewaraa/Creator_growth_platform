'use client';

import {
  LOOK_KEYS,
  LOOK_VOCABULARY,
  type CompiledPromptView,
  type JobStage,
  type JobStatus,
  type JobView,
  type LookKey,
  type TargetPlatform,
} from '@cgp/contracts';
import { Button, Chip, cx, SegmentedControl } from '@cgp/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { artStyle } from '@/lib/art';
import { WorkLedger } from './work-ledger';
import {
  ImageOutput,
  OutputView,
  SECONDS_PER_SCENE,
  Storyboard,
  VideoOutput,
  type ReelScene,
  type Rendition,
} from './output-view';
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
  storyboard: Array<{ index: number; url: string; prompt: string }> | null;
  scenes: ReelScene[] | null;
  rendition: Rendition | null;
  /** The prompt this was made from, so a redraw can reuse it rather than compile a new one. */
  compiledPromptId: string;
}

interface Kind {
  key: string;
  label: string;
  hint: string;
  /** What this generator makes, which is how its templates are found. */
  outputType: string;
  soon?: boolean;
}

const LOOK_LABELS: Record<LookKey, string> = {
  camera: 'Camera',
  lens: 'Lens',
  focalLength: 'Focal',
  aperture: 'Aperture',
};

/**
 * What the picture model allows in a minute (WP40). A storyboard of more than this many
 * frames is paced rather than refused, and saying so beats a creator watching a spinner and
 * wondering what broke.
 */
const IMAGES_PER_MINUTE = 2;

/** The kinds that make a picture or film one, and so take a look (WP37). */
const VISUAL = new Set(['image', 'thumbnail_set', 'video']);

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
  // The look (WP37): the parts a creator picked, each outranking the template's (FR-PO-06).
  const [look, setLook] = useState<Partial<Record<LookKey, string>>>({});
  const [templateId, setTemplateId] = useState<string | null>(null);
  // The templates for what is being made, plain one first, since that is the default.
  const outputType = KINDS.find((k) => k.key === kind)?.outputType;
  const kindTemplates = templates
    .filter((template) => template.outputType === outputType)
    .sort((a, b) => Number(b.slug.startsWith('default-')) - Number(a.slug.startsWith('default-')));

  const [cost, setCost] = useState<{ credits: number; videoSeconds: number } | null>(null);
  const [storyboardCost, setStoryboardCost] = useState<number | null>(null);
  // The storyboard this reel would be committed from, once one has been drawn and looked at.
  const [storyboardId, setStoryboardId] = useState<string | null>(null);
  // What one frame costs to draw again, and which one is being drawn (WP50).
  const [redrawCredits, setRedrawCredits] = useState<number | null>(null);
  const [redrawing, setRedrawing] = useState<number | null>(null);
  // The scene being filmed again, and what one costs in the currency it is paid in (WP50).
  const [refilming, setRefilming] = useState<string | null>(null);
  const [prompt, setPrompt] = useState<CompiledPromptView | null>(null);
  const [promptFor, setPromptFor] = useState<string | null>(null);
  const [busy, setBusy] = useState<'compiling' | 'starting' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [jobs, setJobs] = useState(initialJobs);
  const [job, setJob] = useState<JobView | null>(null);
  const [jobIntent, setJobIntent] = useState('');
  const [streamed, setStreamed] = useState('');
  // What the worker says it is doing (WP44). Keyed, so a stage that reports twice — working
  // then done — updates its line rather than adding a second one.
  const [stages, setStages] = useState<JobStage[]>([]);
  const [outputs, setOutputs] = useState<Output[]>([]);
  const opened = useRef(false);

  const input = {
    intentText: intent.trim(),
    targetPlatform: platform,
    ...(tone.trim() ? { tone: tone.trim() } : {}),
    ...(kind === 'script' && length ? { durationSeconds: length } : {}),
    ...(kind === 'image' ? { count } : {}),
    ...(VISUAL.has(kind) ? look : {}),
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

  // What a storyboard of this many scenes costs, priced by the server like anything else.
  useEffect(() => {
    const timer = setTimeout(() => {
      if (kind !== 'video' || !input.intentText) {
        setStoryboardCost(null);
        return;
      }
      void fetch(`${base}/generate/storyboard/estimate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      })
        .then(async (r) => (r.ok ? ((await r.json()) as { estimate: { credits: number } }) : null))
        .then((body) => setStoryboardCost(body?.estimate.credits ?? null))
        .catch(() => setStoryboardCost(null));
    }, 300);
    return () => clearTimeout(timer);
    // requestKey captures every field of the input.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, kind, requestKey]);

  // What one frame costs to draw again, priced by the server against the rates in force. It
  // depends on the storyboard on screen, so it is fetched when one appears rather than typed.
  const shownStoryboardId = outputs[0]?.storyboard ? outputs[0].id : null;
  useEffect(() => {
    const ask = async () => {
      if (!shownStoryboardId) return setRedrawCredits(null);
      const r = await fetch(`${base}/generate/redraw_frame/estimate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          // The price of a picture does not depend on the words, and the storyboard already
          // holds the scene this would redraw; the schema wants an intent, so it gets one.
          intentText: 'redraw',
          storyboardOutputId: shownStoryboardId,
          frameIndex: 0,
        }),
      }).catch(() => null);
      const body = r?.ok ? ((await r.json()) as { estimate: { credits: number } }) : null;
      setRedrawCredits(body?.estimate.credits ?? null);
    };
    void ask();
  }, [base, shownStoryboardId]);

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
    events.addEventListener('stage', (e) => {
      const { stage } = JSON.parse((e as MessageEvent<string>).data) as { stage: JobStage };
      setStages((current) => {
        const at = current.findIndex((s) => s.key === stage.key);
        if (at === -1) return [...current, stage];
        const next = [...current];
        next[at] = stage;
        return next;
      });
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
      setStages([]);
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

  async function generate(as: string = kind, extra: Record<string, unknown> = {}) {
    setBusy('starting');
    setError(null);
    // A compiled prompt is only reusable by the generator it was compiled for; the storyboard
    // and the reel share one, since both compile as video.
    const usePrompt = prompt && !stale ? prompt.id : undefined;
    const r = await fetch(`${base}/generate/${as}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ...input,
        ...(usePrompt ? { compiledPromptId: usePrompt } : {}),
        // Last, so a caller that knows which prompt this belongs to outranks the open one: a
        // redraw reuses the storyboard's prompt rather than compiling a new one (WP50).
        ...extra,
      }),
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
    // Three panes where there is room (WP45): what you are asking for, what the engine made of
    // it, and what came back. Below that the prompt falls under the controls, as it did when
    // it was a footnote to them.
    // Grid items default to min-width:auto, so a pane refuses to shrink below its own content.
    // The minmax(0,…) tracks cover that from lg up; below lg there are no tracks at all, which
    // is why the Studio overflowed at phone and tablet width and nowhere else (WP49).
    <div className="grid items-start gap-6 *:min-w-0 lg:grid-cols-[minmax(0,44fr)_minmax(0,56fr)] xl:grid-cols-[minmax(0,30fr)_minmax(0,32fr)_minmax(0,38fr)]">
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
                      'tap-target cursor-pointer rounded-full border px-3 py-1.5 text-sm transition',
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
                        'tap-target cursor-pointer rounded-full border px-3 py-1.5 text-sm transition',
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
                        'tap-target cursor-pointer rounded-full border px-3 py-1.5 text-sm transition',
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

            {VISUAL.has(kind) ? (
              <div className="flex flex-col gap-2">
                <span className="text-xs font-medium uppercase tracking-wide text-muted">Look</span>
                {LOOK_KEYS.map((key) => (
                  <div key={key} className="flex flex-wrap items-center gap-1.5">
                    <span className="w-16 shrink-0 text-[11px] text-faint">{LOOK_LABELS[key]}</span>
                    {LOOK_VOCABULARY[key].map((option) => (
                      <Chip
                        key={option.id}
                        title={option.phrase}
                        selected={look[key] === option.id}
                        onClick={() =>
                          // Picking the chosen one again clears it, so a creator can take a
                          // part back out rather than being stuck with a look once touched.
                          setLook((current) => ({
                            ...current,
                            [key]: current[key] === option.id ? undefined : option.id,
                          }))
                        }
                      >
                        {option.label}
                      </Chip>
                    ))}
                  </div>
                ))}
                <span className="text-[11px] text-muted">
                  Written into the prompt as the engine composes it. Leave it alone and the template
                  decides.
                </span>
              </div>
            ) : null}

            {kind === 'video' ? (
              <div className="flex flex-col gap-2">
                <span className="text-xs font-medium uppercase tracking-wide text-muted">
                  Scenes
                </span>
                <SegmentedControl
                  name="scene-count"
                  label="Scenes"
                  value={sceneCount}
                  onChange={setSceneCount}
                  options={[1, 2, 3].map((n) => ({ value: n, label: String(n) }))}
                />
                <span className="text-[11px] text-muted">
                  Eight seconds each, so {sceneCount * 8}s in all.
                  {sceneCount > IMAGES_PER_MINUTE
                    ? ` A storyboard of ${sceneCount} takes about a minute to draw: the picture model allows ${IMAGES_PER_MINUTE} a minute.`
                    : ''}
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
                          'tap-target cursor-pointer rounded-full border px-3 py-1.5 text-sm transition',
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

          {/* On a narrow screen the prompt stays here, under the controls it was made from. */}
          {prompt ? (
            <div className="xl:hidden">
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
            </div>
          ) : null}
        </div>

        <footer className="sticky bottom-0 flex flex-col gap-3 rounded-b-2xl border-t border-line bg-surface/95 px-6 py-4 backdrop-blur">
          {error ? <p className="text-sm text-bad">{error}</p> : null}
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="text-muted">
              {input.intentText && cost !== null ? (
                cost.videoSeconds > 0 ? (
                  <>
                    Costs{' '}
                    <span className="font-semibold text-ink tabular-nums">
                      {cost.videoSeconds}s of video
                    </span>{' '}
                    {/* Per scene, from the server's own estimate rather than a number
                        repeated here: the generator decides what a scene costs. */}
                    <span className="text-faint">
                      ({sceneCount} x {Math.round(cost.videoSeconds / Math.max(sceneCount, 1))}s)
                    </span>
                  </>
                ) : (
                  <>
                    Costs <span className="font-semibold text-ink">{credit(cost.credits)}</span>
                  </>
                )
              ) : (
                'Cost shows once you describe it'
              )}
            </span>
            <span className="text-muted">
              {cost?.videoSeconds ? (
                <>
                  Leaves{' '}
                  <span className="tabular-nums text-ink">
                    {Math.max(0, videoSeconds - cost.videoSeconds).toLocaleString('en-IN')}s
                  </span>{' '}
                  <span className="text-faint">of {videoSeconds.toLocaleString('en-IN')}s</span>
                </>
              ) : (
                <>
                  Balance{' '}
                  <span className="tabular-nums text-ink">{credits.toLocaleString('en-IN')}</span>
                </>
              )}
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
            {kind === 'video' ? (
              <Button
                variant="secondary"
                onClick={() => {
                  setStoryboardId(null);
                  void generate('storyboard');
                }}
                disabled={!canGo}
                className="flex-1"
              >
                {busy === 'starting'
                  ? 'Starting…'
                  : `Storyboard first${storyboardCost === null ? '' : ` · ${credit(storyboardCost)}`}`}
              </Button>
            ) : null}
            <Button
              onClick={() =>
                void generate(kind, storyboardId ? { storyboardOutputId: storyboardId } : {})
              }
              disabled={!canGo || (kind === 'video' && videoSeconds < (cost?.videoSeconds ?? 0))}
              className="flex-1"
            >
              {busy === 'starting'
                ? 'Starting…'
                : kind === 'video'
                  ? storyboardId
                    ? 'Film this storyboard'
                    : 'Film it'
                  : 'Generate'}
            </Button>
          </div>
          <p className="text-[11px] text-muted">
            Writing the prompt is free. Credits are held when you generate, charged when it is done,
            and refunded in full if it fails or is blocked.
          </p>
        </footer>
      </section>

      {/* Right: the output, then what was made before. */}
      {/*
        The engine's own pane (WP45). It is the product and step 2 of the demo, and it used to
        be a strip at the bottom of the controls. Collapsed by default still, because plan
        section 13 says so: the room is for when it is open, not an argument for opening it.
      */}
      <section className="hidden flex-col gap-3 xl:flex xl:sticky xl:top-20">
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
        ) : (
          <div className="flex flex-col gap-2 rounded-2xl border border-dashed border-line p-5">
            <p className="text-subtitle font-medium text-ink">The prompt appears here</p>
            <p className="text-body text-muted">
              Say what you want in plain words, then see the prompt the engine writes from it: your
              profile, your brand kit and the platform&rsquo;s own limits, assembled. You can read
              it, and change it, before anything is spent.
            </p>
          </div>
        )}
      </section>

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
                outputs[0]?.storyboard ? (
                  <Storyboard
                    frames={outputs[0].storyboard}
                    // What filming it would spend, from the same estimate the submit bar
                    // uses: the price belongs next to the decision (WP46).
                    {...(cost?.videoSeconds ? { videoSeconds: cost.videoSeconds } : {})}
                    committed={storyboardId === outputs[0].id}
                    onCommit={() => {
                      const id = outputs[0]?.id;
                      if (!id) return;
                      setStoryboardId(id);
                      void generate('video', { storyboardOutputId: id });
                    }}
                    redrawCredits={redrawCredits}
                    redrawing={redrawing}
                    onRedraw={(index, note) => {
                      const output = outputs[0];
                      if (!output) return;
                      setRedrawing(index);
                      // The storyboard's own prompt, not a fresh one: re-compiling would plan
                      // the scenes again and quietly move the two frames nobody asked about.
                      void generate('redraw_frame', {
                        intentText: shownIntent || input.intentText || 'Redraw',
                        storyboardOutputId: output.id,
                        frameIndex: index,
                        compiledPromptId: output.compiledPromptId,
                        ...(note ? { note } : {}),
                      }).finally(() => setRedrawing(null));
                    }}
                  />
                ) : outputs[0]?.kind === 'video' && outputs[0].media ? (
                  <VideoOutput
                    {...outputs[0].media}
                    scenes={outputs[0].scenes ?? []}
                    refilmSeconds={SECONDS_PER_SCENE}
                    refilming={refilming}
                    onRefilm={(sceneId) => {
                      const output = outputs[0];
                      if (!output) return;
                      setRefilming(sceneId);
                      void generate('regenerate_scene', {
                        intentText: shownIntent || input.intentText || 'Film this scene again',
                        sceneId,
                        compiledPromptId: output.compiledPromptId,
                      }).finally(() => setRefilming(null));
                    }}
                  />
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
                // The work ledger where the blank wait used to be (WP44). It only appears once
                // the worker has said something; until then the sentence below sets the
                // expectation, which for a reel is minutes.
                stages.length > 0 ? (
                  <WorkLedger stages={stages} />
                ) : (
                  <p className="text-body text-muted">
                    {job.generatorKey === 'video'
                      ? 'Filming scene by scene, then joining them. Minutes, not seconds.'
                      : DRAWN.has(job.generatorKey)
                        ? 'Drawing it now; pictures arrive all at once.'
                        : 'Waiting for the first words…'}
                  </p>
                )
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
                      'flex min-h-11 w-full cursor-pointer items-center gap-3 rounded-xl px-3 py-2 text-left transition hover:bg-raised',
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
                    <span
                      className="w-16 shrink-0 text-right text-[11px] text-muted"
                      title={new Date(j.createdAt).toLocaleString('en-IN')}
                      // "4 min ago" on the server is "5 min ago" by the time the browser
                      // renders it, which React reports as a hydration mismatch. The clock is
                      // the client's to read.
                      suppressHydrationWarning
                    >
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
