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
import {
  Button,
  CameraIcon,
  ChevronDownIcon,
  ClockIcon,
  CloseIcon,
  cx,
  Dialog,
  EyeIcon,
  FilmIcon,
  GearIcon,
  ImageIcon,
  LinkIcon,
  MicIcon,
  PaletteIcon,
  PlusIcon,
  Select,
  SparklesIcon,
  Tabs,
  Toggle,
  TypeIcon,
} from '@cgp/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
  type SVGProps,
} from 'react';
import { GalleryFeed } from '@/components/gallery-feed';
import { STUDIO_KINDS } from '@/lib/studio-kinds';
import { GenerationStatus } from './generation-status';
import { KindPickerDialog } from './kind-picker-dialog';
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
import { TemplatesDialog } from './templates-dialog';
import type { TemplateCard } from './template-picker';
import { PromptDisclosure } from './prompt-disclosure';
import { ControlPanel } from './control-panel';

// Studio (plan section 13, WP14, redone WP56): plain intent in, compiled prompt visible and
// editable, cost before submit, output streamed, and the job carries on if you leave.
//
// What you want to make is decided once, by the kind picker dialog (or a `?kind=` link from
// Home), not re-asked by a card grid eating a third of the screen on every visit. Everything
// below is the layout for a kind already chosen: a prompt, its controls, and what comes back.

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

const LOOK_LABELS: Record<LookKey, string> = {
  camera: 'Camera',
  lens: 'Lens',
  focalLength: 'Focal length',
  aperture: 'Aperture',
};

/** The kinds that make a picture or film one, and so take a look (WP37). */
const VISUAL = new Set(['image', 'thumbnail_set', 'video']);
/** The kinds whose model reads a reference picture (WP60): Veo has no equivalent for video. */
// Veo has no reference-image feature of its own, but Omni does (WP63), so video joins this
// set too now — the reference section just shows for one more kind, the model picker decides
// which provider actually reads what gets uploaded.
const REFERENCEABLE = new Set(['image', 'thumbnail_set', 'video']);

// The six generators, named once in @/lib/studio-kinds so Home's cards, this dialog and the
// picker never drift apart (WP53).
const KINDS = STUDIO_KINDS;
const LABEL: Record<string, string> = Object.fromEntries(KINDS.map((k) => [k.key, k.label]));
// The four kinds the compose bar fronts with directly — Script, Image, Thumbnail, Video
// (WP66) — chosen via the segmented control in control-panel.tsx; the rest stay one tap away,
// behind "More kinds" and the kind picker dialog they always lived in.

const PLATFORMS: Array<{ value: TargetPlatform; label: string }> = [
  { value: 'instagram', label: 'Instagram' },
  { value: 'linkedin', label: 'LinkedIn' },
];
const LENGTHS = [15, 30, 45, 60, 90];
const COUNTS = [1, 2, 3, 4];
// A length to ask for, not a scene count to pick: the planner decides how many eight-second
// beats best fill it (WP59). Bounded to match packages/core's MIN/MAX_VIDEO_SECONDS.
const VIDEO_DURATIONS = [8, 16, 24, 32, 40, 48];
// The Lite model's own hard ceiling (packages/adapters/src/models.ts) — the 2.1 model allows
// more, but a request moved between models should never lose an upload the other would keep.
const MAX_REFERENCE_IMAGES = 3;
// Video references only exist on Omni (Veo takes one start frame, not a reference set) — its
// own ceiling, raised from the shared image cap above to actually test it (WP67).
const VIDEO_REFERENCE_CAP = 10;
const IMAGE_MODEL_OPTIONS = [
  { value: 'gemini-flash-lite-image', label: 'Nano Banana 2 Lite (current)' },
  { value: 'gemini-nano-banana-2-1', label: 'Nano Banana 2.1' },
  { value: 'gemini-3-pro-image', label: 'Nano Banana Pro' },
];
const VIDEO_MODEL_OPTIONS = [
  { value: 'veo-3.1-lite', label: 'Veo 3.1 Lite (current)' },
  { value: 'gemini-omni-1.1-flash', label: 'Gemini Omni 1.1 Flash' },
];

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

/** A control row's label, with an icon so the panel reads at a glance (WP56). */
function ControlLabel({
  icon: Icon,
  children,
}: {
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  children: ReactNode;
}) {
  return (
    <span className="flex items-center gap-1.5 text-label font-medium uppercase tracking-wide text-muted">
      <Icon width={13} height={13} aria-hidden className="text-faint" />
      {children}
    </span>
  );
}

/** A dropdown with its own chevron, the shape every select in the app already uses. */
function Dropdown({
  value,
  onChange,
  options,
  'aria-label': ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  'aria-label': string;
}) {
  return (
    <div className="relative">
      <Select
        aria-label={ariaLabel}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 pr-9 text-sm"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </Select>
      <ChevronDownIcon
        aria-hidden
        className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-faint"
      />
    </div>
  );
}

/** A quick chip for the compose bar (WP65): the same Select as Dropdown, just round and
 *  small enough to sit in a scrolling row of them rather than a form grid. */
function ChipDropdown({
  value,
  onChange,
  options,
  'aria-label': ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  'aria-label': string;
}) {
  return (
    <div className="relative shrink-0">
      <Select
        aria-label={ariaLabel}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-9 w-auto min-w-0 rounded-full border-line bg-raised pl-3.5 pr-8 text-xs font-medium"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </Select>
      <ChevronDownIcon
        width={12}
        height={12}
        aria-hidden
        className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-faint"
      />
    </div>
  );
}

export function Studio({
  workspaceId,
  credits,
  videoSeconds,
  ready,
  initialJobs,
  initialJobId,
  initialKind,
  initialIntent,
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
  /** Arriving with a kind already decided skips the picker dialog (WP53/56). */
  initialKind: string | null;
  /** A trend's hook, handed in from the Trend Radar's "Use this trend" (WP61). */
  initialIntent: string | null;
  profileTone: string | null;
  /** The brand kit's colours, offered first when a text layer is coloured. */
  brandColours: string[];
  /** Every template with its real preview and price (WP19). */
  templates: TemplateCard[];
  /** Card art from public/art, for the kind picker's tiles. */
  art: string[];
}) {
  const router = useRouter();
  const base = `/api/w/${workspaceId}`;

  const startingKind = KINDS.find((k) => k.key === initialKind)?.key ?? null;
  const [kind, setKind] = useState(startingKind ?? 'image');
  // Only asked when nobody said yet (WP56): a link from Home already knows, so it never opens.
  const [kindDialogOpen, setKindDialogOpen] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [promptOpen, setPromptOpen] = useState(false);
  // The rest of the controls (WP65 reskin): everything that isn't one of the always-visible
  // quick chips lives behind this one dialog instead of eating permanent page space — the
  // Orbis-style bar stays a handful of pills and a text box, not a form.
  const [moreOpen, setMoreOpen] = useState(false);

  const [intent, setIntent] = useState(initialIntent ?? '');
  const [platform, setPlatform] = useState<TargetPlatform | null>('instagram');
  const [captionFor, setCaptionFor] = useState<TargetPlatform[]>([]);
  const [length, setLength] = useState<number | null>(null);
  const [count, setCount] = useState(1);
  // Empty means the platform decides, same as it always has (WP64) — this only ever sends a
  // user override when there is one.
  const [aspectRatio, setAspectRatio] = useState('');
  // How long the reel should run; how many eight-second beats fill that is for the engine's
  // scene planner to decide, not the creator (WP59) — a calm piece wants fewer, longer-held
  // beats, a fight wants several quick ones, both inside the same requested length.
  const [durationSeconds, setDurationSeconds] = useState(24);
  // Off for a reel that should carry no spoken narration (WP58): a fight scene is not a video
  // essay, and captions are timed by the voice, so they turn off together with it.
  const [voiceover, setVoiceover] = useState(true);
  const [tone, setTone] = useState('');
  // The look (WP37): the parts a creator picked, each outranking the template's (FR-PO-06).
  const [look, setLook] = useState<Partial<Record<LookKey, string>>>({});
  const [templateId, setTemplateId] = useState<string | null>(null);
  // Pictures to stay consistent with, for the models that read them (WP60/63). Capped at
  // three — the Lite model's own hard ceiling, and more than that is a gallery, not a
  // reference.
  const [referenceImages, setReferenceImages] = useState<Array<{ key: string; url: string }>>([]);
  const [referenceUploading, setReferenceUploading] = useState(false);
  const [referenceError, setReferenceError] = useState<string | null>(null);
  const referenceInputRef = useRef<HTMLInputElement>(null);
  // Which image model draws it (WP63): a picture a creator can see and change their mind
  // about, kept per-kind-visit rather than defaulted away from what the generator itself
  // already defaults to server side.
  const [imageModel, setImageModel] = useState<string>('gemini-flash-lite-image');
  const [videoModel, setVideoModel] = useState<string>('veo-3.1-lite');

  // The templates for what is being made, plain one first, since that is the default.
  const outputType = KINDS.find((k) => k.key === kind)?.outputType;
  const kindTemplates = templates
    .filter((template) => template.outputType === outputType)
    .sort((a, b) => Number(b.slug.startsWith('default-')) - Number(a.slug.startsWith('default-')));
  const selectedTemplate = kindTemplates.find((t) => t.id === templateId);

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
    ...((kind === 'image' || kind === 'video') && aspectRatio ? { aspectRatio } : {}),
    ...(VISUAL.has(kind) ? look : {}),
    ...(kind === 'video'
      ? { targetDurationSeconds: durationSeconds, voiceover, videoModel }
      : {}),
    ...(REFERENCEABLE.has(kind) && referenceImages.length > 0
      ? { referenceImageKeys: referenceImages.map((r) => r.key) }
      : {}),
    ...(kind === 'image' || kind === 'thumbnail_set' ? { imageModel } : {}),
    ...(templateId ? { templateId } : {}),
    ...(kind === 'caption_set' && captionFor.length ? { platforms: captionFor } : {}),
  };
  const requestKey = JSON.stringify({ kind, input });
  const stale = prompt !== null && promptFor !== requestKey && !prompt.userEdited;
  const blocked = !ready.profile || !ready.brandKit;
  const canGo = busy === null && intent.trim().length > 0 && !blocked;

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

  async function uploadReference(file: File) {
    setReferenceUploading(true);
    setReferenceError(null);
    const form = new FormData();
    form.set('file', file);
    const r = await fetch(`${base}/references`, { method: 'POST', body: form }).catch(() => null);
    setReferenceUploading(false);
    const body = (await r?.json().catch(() => ({}))) as ApiBody & {
      reference?: { key: string; url: string };
    };
    if (!r?.ok || !body.reference) {
      setReferenceError(refusal(body ?? {}));
      return;
    }
    const reference = body.reference;
    setReferenceImages((current) => [...current, reference]);
  }

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
    if (!r?.ok || !body.prompt) {
      setError(refusal(body ?? {}));
      return null;
    }
    setPrompt(body.prompt);
    setPromptFor(requestKey);
    return body.prompt;
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

  /** Switching kind, from the dialog or from the tabs below (WP64) — one reset either way. */
  function selectKind(picked: string) {
    setKind(picked);
    setTemplateId(null);
    setReferenceImages([]);
    setAspectRatio('');
    setKindDialogOpen(false);
    router.replace(`?kind=${picked}`, { scroll: false });
  }

  /** Back to the gallery (WP65): a job stays reachable by its own URL, but closing it should
   *  not lose the words already typed, only the result that was looking at them. */
  function closeJob() {
    setJob(null);
    setOutputs([]);
    setStreamed('');
    setStages([]);
    setError(null);
    window.history.replaceState(null, '', `?kind=${kind}`);
  }

  return (
    <>
      <KindPickerDialog open={kindDialogOpen} art={art} onPick={selectKind} />

      {/*
        The reskin (WP65): the gallery is the page now, not a pane next to the form — a
        fixed backdrop under the header and rail, scrolling on its own. A job in progress (or
        just finished) takes that same backdrop over as a centred card; closing it goes back
        to the gallery without losing what was typed. Everything you ask for lives in one
        floating bar, docked to the bottom of that backdrop rather than claiming a column of
        its own.
      */}
      <div className="fixed inset-x-0 bottom-0 top-14 z-0 overflow-y-auto">
        <div className="w-full px-2 sm:px-4 pb-56 pt-2">
          {blocked ? (
            <div className="mb-4 rounded-xl border border-accent/40 bg-accent/10 px-4 py-3 text-sm text-ink backdrop-blur">
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

          {job ? (
            <div className="mx-auto flex max-w-6xl flex-col gap-4 lg:flex-row lg:items-start">
              <div className="min-w-0 flex-1">
                <button
                  type="button"
                  onClick={closeJob}
                  className="tap-target mb-3 flex cursor-pointer items-center gap-1.5 rounded-lg px-2 py-1 text-sm text-muted transition-colors duration-base ease-standard hover:text-ink"
                >
                  <CloseIcon width={16} height={16} aria-hidden />
                  Back to the gallery
                </button>
                <section className="flex flex-col gap-4 rounded-2xl border border-line bg-surface/95 p-5 shadow-floating backdrop-blur">
                {outputs.length > 0 ? (
                  outputs[0]?.storyboard ? (
                    <Storyboard
                      frames={outputs[0].storyboard}
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
                ) : streamed && (!TERMINAL.has(job.status) || job.status === 'COMPLETE') ? (
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
                  stages.length > 0 ? (
                    <WorkLedger stages={stages} />
                  ) : (
                    <GenerationStatus
                      kind={job.generatorKey}
                      sceneCount={Math.max(1, Math.round(durationSeconds / SECONDS_PER_SCENE))}
                      label={
                        job.generatorKey === 'video'
                          ? 'Filming scene by scene'
                          : DRAWN.has(job.generatorKey)
                            ? 'Drawing it now'
                            : 'Writing…'
                      }
                    />
                  )
                ) : job.status === 'COMPLETE' ? (
                  <p className="text-sm text-muted">Loading the result…</p>
                ) : null}
                </section>
              </div>

              {/* The details that used to sit above the output now live beside it, in the
                  width a wide screen actually has free — a job's status, its cost and the
                  next action, rather than a narrow column with empty canvas on either side. */}
              <aside className="flex w-full flex-col gap-4 rounded-2xl border border-line bg-surface/95 p-5 shadow-floating backdrop-blur lg:w-80 lg:shrink-0">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-ink">
                      {LABEL[job.generatorKey] ?? job.generatorKey}
                    </p>
                    {shownIntent ? (
                      <p className="line-clamp-3 text-xs text-muted">{shownIntent}</p>
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

                {kind === 'video' && outputs[0]?.storyboard ? null : (
                  <div className="flex flex-col gap-2 border-t border-line pt-4">
                    {kind === 'video' ? (
                      <Button
                        variant="secondary"
                        onClick={() => {
                          setStoryboardId(null);
                          void generate('storyboard');
                        }}
                        disabled={!canGo}
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
                      disabled={
                        !canGo || (kind === 'video' && videoSeconds < (cost?.videoSeconds ?? 0))
                      }
                    >
                      {busy === 'starting'
                        ? 'Starting…'
                        : kind === 'video'
                          ? storyboardId
                            ? 'Film this storyboard'
                            : 'Film it'
                          : 'Generate another'}
                    </Button>
                  </div>
                )}
              </aside>
            </div>
          ) : (
            <>
              {jobs.some((j) => !TERMINAL.has(j.status)) ? (
                <div className="mb-2.5 flex gap-1.5 overflow-x-auto pb-1 no-scrollbar select-none">
                  {jobs
                    .filter((j) => !TERMINAL.has(j.status))
                    .map((j) => (
                      <button
                        key={j.id}
                        type="button"
                        onClick={() => void openJob(j.id)}
                        className="tap-target flex shrink-0 cursor-pointer items-center gap-1.5 rounded-full border border-line bg-surface/90 px-2.5 py-1 text-xs text-muted backdrop-blur transition-colors duration-base ease-standard hover:text-ink hover:border-faint"
                      >
                        <span
                          className={cx(
                            'size-1.5 shrink-0 rounded-full',
                            STATUS[j.status].tone.includes('good')
                              ? 'bg-good'
                              : STATUS[j.status].tone.includes('bad')
                                ? 'bg-bad'
                                : STATUS[j.status].tone.includes('accent')
                                  ? 'bg-accent'
                                  : 'bg-faint',
                          )}
                          aria-hidden
                        />
                        <span className="max-w-32 truncate">{j.intentText || LABEL[j.generatorKey]}</span>
                      </button>
                    ))}
                </div>
              ) : null}
              <GalleryFeed
                workspaceId={workspaceId}
                onOpen={(id) => void openJob(id)}
                onUsePrompt={(prompt) => setIntent(prompt)}
              />
            </>
          )}
        </div>
      </div>

      {/* Floating Control Panel matching exact reference design */}
      <div className="fixed inset-x-0 bottom-6 z-20 flex flex-col items-center justify-center px-3 sm:px-4 pointer-events-none">
        <div className="pointer-events-auto w-full max-w-[980px] flex flex-col items-center">
          {error ? (
            <div className="mb-2 max-w-[980px] w-full rounded-xl border border-bad/30 bg-surface/95 px-3 py-1.5 text-xs text-bad shadow-md backdrop-blur">
              {error}
            </div>
          ) : null}
          <ControlPanel
            kind={kind}
            onKindChange={selectKind}
            intent={intent}
            onIntentChange={setIntent}
            onGenerate={(as) => void generate(as ?? kind, storyboardId ? { storyboardOutputId: storyboardId } : {})}
            busy={busy}
            canGo={canGo}
            cost={cost}
            storyboardCost={storyboardCost}
            storyboardId={storyboardId}
            videoSecondsBalance={videoSeconds}
            look={look}
            onLookChange={(key, val) => setLook((current) => ({ ...current, [key]: val }))}
            platform={platform}
            onPlatformChange={setPlatform}
            scriptLength={length}
            onScriptLengthChange={setLength}
            tone={tone}
            onToneChange={setTone}
            profileTone={profileTone}
            templates={templates}
            selectedTemplateId={templateId}
            onSelectTemplate={setTemplateId}
            onOpenTemplatesDialog={() => setTemplatesOpen(true)}
            referenceImages={referenceImages}
            onUploadReference={(file) => void uploadReference(file)}
            onRemoveReference={(idx) => setReferenceImages((curr) => curr.filter((_, i) => i !== idx))}
            referenceUploading={referenceUploading}
            aspectRatio={aspectRatio}
            onAspectRatioChange={setAspectRatio}
            count={count}
            onCountChange={setCount}
            imageModel={imageModel}
            onImageModelChange={setImageModel}
            videoModel={videoModel}
            onVideoModelChange={setVideoModel}
            videoDuration={durationSeconds}
            onVideoDurationChange={setDurationSeconds}
            voiceover={voiceover}
            onVoiceoverChange={setVoiceover}
            onStoryboardFirst={
              kind === 'video'
                ? () => {
                    setStoryboardId(null);
                    void generate('storyboard');
                  }
                : undefined
            }
            onOpenPromptDisclosure={async () => {
              if (!prompt || stale) await compile();
              setPromptOpen(true);
            }}
            onOpenKindsDialog={() => setKindDialogOpen(true)}
            onOpenMoreDialog={() => setMoreOpen(true)}
          />
        </div>
      </div>

      <Dialog
        open={moreOpen}
        onClose={() => setMoreOpen(false)}
        title="More controls"
        className="max-w-lg"
      >
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="studio-tone" className="flex items-center gap-1.5">
              <ControlLabel icon={SparklesIcon}>
                Tone for this one <span className="normal-case text-faint">(optional)</span>
              </ControlLabel>
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

          {!VISUAL.has(kind) ? (
            <div className="flex flex-col gap-1.5">
              <ControlLabel icon={LinkIcon}>For</ControlLabel>
              <Dropdown
                aria-label="Platform"
                value={platform ?? ''}
                onChange={(v) => setPlatform(v === '' ? null : (v as TargetPlatform))}
                options={[{ value: '', label: 'Anywhere' }, ...PLATFORMS]}
              />
            </div>
          ) : null}

          {kind === 'caption_set' ? (
            <div className="flex flex-col gap-1.5">
              <ControlLabel icon={TypeIcon}>Captions for</ControlLabel>
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
              <span className="text-caption text-faint">None picked: the platform above.</span>
            </div>
          ) : null}

          {REFERENCEABLE.has(kind) ? (
            <div className="flex flex-col gap-1.5">
              <ControlLabel icon={ImageIcon}>
                Reference images{' '}
                <span className="normal-case text-faint">
                  (optional, up to {kind === 'video' ? VIDEO_REFERENCE_CAP : MAX_REFERENCE_IMAGES})
                </span>
              </ControlLabel>
              <div className="flex flex-wrap gap-2">
                {referenceImages.map((ref, index) => (
                  <div
                    key={ref.key}
                    className="group relative size-16 shrink-0 overflow-hidden rounded-lg border border-line"
                  >
                    <img src={ref.url} alt="" className="size-full object-cover" />
                    <button
                      type="button"
                      onClick={() =>
                        setReferenceImages((current) => current.filter((_, i) => i !== index))
                      }
                      className="tap-target absolute inset-0 flex cursor-pointer items-center justify-center bg-black/60 text-canvas opacity-0 transition-opacity duration-base ease-standard group-hover:opacity-100 group-focus-visible:opacity-100"
                      aria-label="Remove this reference image"
                    >
                      <CloseIcon width={18} height={18} />
                    </button>
                  </div>
                ))}
                {referenceImages.length <
                (kind === 'video' ? VIDEO_REFERENCE_CAP : MAX_REFERENCE_IMAGES) ? (
                  <button
                    type="button"
                    onClick={() => referenceInputRef.current?.click()}
                    disabled={referenceUploading}
                    aria-label="Add a reference image"
                    className="tap-target flex size-16 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-dashed border-line bg-raised text-muted transition-colors duration-base ease-standard hover:border-faint hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {referenceUploading ? (
                      <span className="text-caption">…</span>
                    ) : (
                      <PlusIcon width={18} height={18} aria-hidden />
                    )}
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}

          {kind === 'video' ? (
            <p className="text-caption text-faint">
              However many eight-second beats best tell it, free-flowing, in about{' '}
              {durationSeconds}s.
              {durationSeconds > SECONDS_PER_SCENE
                ? ' The video model films one beat a minute, so a longer piece takes a few minutes.'
                : ''}{' '}
              {kind === 'video' ? 'Omni generates its own sound; voiceover still layers a spoken track over it if it is on.' : ''}
            </p>
          ) : null}

          <p className="text-caption text-muted">
            Writing the prompt is free. Credits are held when you generate, charged when it is
            done, and refunded in full if it fails or is blocked.
          </p>
        </div>
      </Dialog>

      {prompt ? (
        <Dialog
          open={promptOpen}
          onClose={() => setPromptOpen(false)}
          title="The compiled prompt"
          className="max-w-2xl"
        >
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
        </Dialog>
      ) : null}

      <TemplatesDialog
        open={templatesOpen}
        onClose={() => setTemplatesOpen(false)}
        templates={kindTemplates}
        selected={templateId}
        onSelect={setTemplateId}
      />
    </>
  );
}
