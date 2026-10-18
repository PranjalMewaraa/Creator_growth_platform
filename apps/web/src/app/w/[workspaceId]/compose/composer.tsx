'use client';

import { PLATFORM_TEXT_LIMITS, type PostTargetStatus, type TargetPlatform } from '@cgp/contracts';
import type { CaptionTrendFit } from '@cgp/core';
import { Badge, Button, cx, SegmentedControl, SmileIcon, Tabs, TrendIcon, useToast } from '@cgp/ui';
import Link from 'next/link';
import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type ReactNode,
} from 'react';
import { COMING_BACK, IN_FLIGHT, STATUS_BADGE, STATUS_TEXT } from '@/lib/post-status';
import { InstagramPost, LinkedInPost } from './post-previews';

// Split pane (Buffer, Typefully style): compose on the left, a pinned live preview on the
// right. Choose where, then write; the actions stay pinned under the editor.

export interface ComposerAccount {
  id: string;
  platform: TargetPlatform;
  displayName: string;
  /** The team's own account, borrowed rather than connected (WP52): posting through it is real. */
  sharedDemo?: boolean;
}

type Frame = 'portrait' | 'square';

interface TargetView {
  id: string;
  platform: TargetPlatform;
  account: string;
  status: PostTargetStatus;
  permalink: string | null;
  error: { code: string; message: string } | null;
}

interface ApiError {
  error?: { code?: string; category?: string; issues?: Array<{ message: string }> };
}

interface Draft {
  text: string;
  chosen: string[];
  frame: Frame;
  savedAt: string;
}

const LIMITS = PLATFORM_TEXT_LIMITS;
const NAMES: Record<TargetPlatform, string> = { instagram: 'Instagram', linkedin: 'LinkedIn' };
const SHORT: Record<TargetPlatform, string> = { instagram: 'IG', linkedin: 'IN' };
const DOT: Record<TargetPlatform, string> = {
  instagram: 'bg-gradient-to-tr from-[#f9ce34] via-[#ee2a7b] to-[#6228d7]',
  linkedin: 'bg-[#0a66c2]',
};
const EMOJIS =
  '😀 😂 😍 🥳 😎 🤩 🙏 👏 🙌 💪 👀 ✨ 🔥 💯 ❤️ 💛 🎉 🚀 📣 📌 ✅ 👉 ☕ 🌞 📸 🎥 💡 📈 🛍️ 🇮🇳 🪔 🌶️'.split(
    ' ',
  );

function describe(body: ApiError, fallback: string): string {
  const error = body.error;
  if (error?.issues?.length) return error.issues.map((i) => i.message).join('. ');
  if (error?.code === 'blocked') return `Blocked by moderation (${error.category ?? 'policy'}).`;
  if (error?.code === 'moderation_unavailable') return 'Moderation is unavailable; try again.';
  return error?.code ? `${fallback} (${error.code})` : fallback;
}

/** Drafts live in this browser only: text, targets and frame, not the image. */
function draftKey(workspaceId: string) {
  return `cgp:compose-draft:${workspaceId}`;
}

function readDraft(workspaceId: string): Draft | null {
  try {
    const raw = window.localStorage.getItem(draftKey(workspaceId));
    return raw ? (JSON.parse(raw) as Draft) : null;
  } catch {
    return null;
  }
}

function writeDraft(workspaceId: string, draft: Draft | null) {
  try {
    if (draft) window.localStorage.setItem(draftKey(workspaceId), JSON.stringify(draft));
    else window.localStorage.removeItem(draftKey(workspaceId));
    return true;
  } catch {
    return false;
  }
}

function clock(iso: string) {
  return new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
}

/** A scheduled time is days away as often as hours, so it says which day as well. */
function fullClock(iso: string) {
  return new Date(iso).toLocaleString('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** `datetime-local` wants the viewer's own clock, to the minute, with no zone on the end. */
function localInputValue(at: Date) {
  const shifted = new Date(at.getTime() - at.getTimezoneOffset() * 60_000);
  return shifted.toISOString().slice(0, 16);
}

/** The Studio output this page was opened with, if any (WP33). */
function outputFromUrl(): string | null {
  if (typeof window === 'undefined') return null;
  return new URLSearchParams(window.location.search).get('output');
}

/**
 * The slot the calendar sent, if this page was opened from one. Read from the address rather
 * than through a router hook because the composer is client only: the URL is already here.
 */
function slotFromUrl(): string {
  if (typeof window === 'undefined') return '';
  const at = new URLSearchParams(window.location.search).get('at');
  if (!at) return '';
  const when = new Date(at);
  // A slot in the past is a stale link, not a schedule.
  return Number.isNaN(when.getTime()) || when <= new Date() ? '' : localInputValue(when);
}

/** The default offered when scheduling: an hour from now, on the next quarter hour. */
function defaultSchedule(now = new Date()) {
  const at = new Date(now.getTime() + 60 * 60_000);
  at.setSeconds(0, 0);
  at.setMinutes(Math.ceil(at.getMinutes() / 15) * 15);
  return localInputValue(at);
}

function Note({ tone, children }: { tone: 'info' | 'warn' | 'bad'; children: ReactNode }) {
  return (
    <p
      className={cx(
        'rounded-lg border px-3 py-2 text-xs leading-5',
        tone === 'info' && 'border-line bg-raised text-muted',
        tone === 'warn' && 'border-hot/40 bg-hot/10 text-ink',
        tone === 'bad' && 'border-bad/40 bg-bad/10 text-ink',
      )}
    >
      {children}
    </p>
  );
}

export function Composer({
  workspaceId,
  accounts,
  live,
  barColour,
  hashtags,
}: {
  workspaceId: string;
  accounts: ComposerAccount[];
  live: boolean;
  /** The Instagram copy's bar colour, so the preview matches what is posted. */
  barColour: string;
  /** Suggestions from the workspace's content pillars. */
  hashtags: string[];
}) {
  // Rendered only in the browser (see composer-loader), so the draft can seed the state.
  const [initial] = useState(() => readDraft(workspaceId));
  const [text, setText] = useState(initial?.text ?? '');
  const [chosen, setChosen] = useState<string[]>(
    (initial?.chosen ?? []).filter((id) => accounts.some((a) => a.id === id)),
  );
  const [frame, setFrame] = useState<Frame>(initial?.frame ?? 'portrait');
  const [savedAt, setSavedAt] = useState<string | null>(initial?.savedAt ?? null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  // A picture the Studio made, already stored with its Instagram frames (WP33). It stands in
  // for an uploaded file: there is nothing left to upload when the post is sent.
  const [fromStudio, setFromStudio] = useState<{
    key: string;
    url: string;
    outputId: string;
  } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [tab, setTab] = useState<TargetPlatform | null>(null);
  const [busy, setBusy] = useState<'uploading' | 'posting' | 'attaching' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  const [publicationId, setPublicationId] = useState<string | null>(null);
  const [targets, setTargets] = useState<TargetView[]>([]);
  // A datetime-local value, in the viewer's own clock. Empty means post now. An empty slot on
  // the calendar sends its own time here as `?at=`, so the schedule is already filled in.
  const [when, setWhen] = useState(() => slotFromUrl());
  const [scheduledAt, setScheduledAt] = useState<string | null>(null);
  // How well the caption echoes what Trend Radar has ingested (WP62), recomputed a moment
  // after the last keystroke rather than on every one.
  const [fit, setFit] = useState<CaptionTrendFit | null>(null);
  const [fitLoading, setFitLoading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const editor = useRef<HTMLTextAreaElement>(null);
  const previewRef = useRef<string | null>(null);

  const base = `/api/w/${workspaceId}`;
  const selected = accounts.filter((a) => chosen.includes(a.id));
  const platforms = [...new Set(selected.map((a) => a.platform))];
  // Whether sending this would really post from the team's own account rather than the
  // workspace's (WP52): worth saying right where the decision to send is made.
  const usingSharedDemo = selected.some((a) => a.sharedDemo);
  const hasImage = file !== null || fromStudio !== null;
  const imageMissing = platforms.includes('instagram') && !hasImage;
  const over = platforms.filter((p) => text.length > LIMITS[p]);
  // A time that has already gone by is not a schedule. The server checks this too; here it
  // only keeps the button from sending something it knows will come back refused.
  const whenAt = when ? new Date(when) : null;
  const whenValid = whenAt !== null && !Number.isNaN(whenAt.getTime()) && whenAt > new Date();
  const canPost =
    busy === null &&
    chosen.length > 0 &&
    (text.trim().length > 0 || hasImage) &&
    !imageMissing &&
    over.length === 0 &&
    (when === '' || whenValid);

  // The preview shows the chosen platforms; with none chosen, every connected one.
  const previewAccounts = selected.length > 0 ? selected : accounts;
  const previewPlatforms = [...new Set(previewAccounts.map((a) => a.platform))];
  const activeTab = tab && previewPlatforms.includes(tab) ? tab : (previewPlatforms[0] ?? null);
  const activeAccount = previewAccounts.find((a) => a.platform === activeTab);

  // Autosave the draft a moment after the last change.
  useEffect(() => {
    if (publicationId) return;
    const timer = setTimeout(() => {
      const draft = { text, chosen, frame, savedAt: new Date().toISOString() };
      const empty = !text.trim() && chosen.length === 0;
      if (writeDraft(workspaceId, empty ? null : draft)) setSavedAt(empty ? null : draft.savedAt);
    }, 700);
    return () => clearTimeout(timer);
  }, [workspaceId, text, chosen, frame, publicationId]);

  // Trend Fit, scored against what Trend Radar has actually ingested — a short pause after
  // typing, not on every keystroke, since it is a real request even though it costs no credits.
  useEffect(() => {
    if (text.trim().length < 10) {
      setFit(null);
      return;
    }
    setFitLoading(true);
    const timer = setTimeout(() => {
      void fetch(`${base}/trends/match`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text }),
      })
        .then(async (r) => (r.ok ? ((await r.json()) as { fit: CaptionTrendFit }) : null))
        .then((body) => setFit(body?.fit ?? null))
        .catch(() => setFit(null))
        .finally(() => setFitLoading(false));
    }, 500);
    return () => clearTimeout(timer);
    // base is derived from workspaceId, which does not change within one composer session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  // Release the last preview's memory when the composer goes away.
  useEffect(
    () => () => {
      if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    },
    [],
  );

  // Something handed over from the Studio (WP33): the server copies it into the workspace's
  // uploads with its Instagram frames, and hands back the key and the caption.
  useEffect(() => {
    const outputId = outputFromUrl();
    if (!outputId) return;
    let stopped = false;
    const run = async () => {
      setBusy('attaching');
      const response = await fetch(`${base}/outputs/${outputId}/attach`, { method: 'POST' }).catch(
        () => null,
      );
      if (stopped) return;
      const body = (await response?.json().catch(() => null)) as
        | (ApiError & {
            upload?: { key: string; url: string; instagramUrl: string };
            text?: string;
            sourceOutputId?: string;
          })
        | null;
      setBusy(null);
      if (!response?.ok || !body?.sourceOutputId) {
        setError(describe(body ?? {}, 'That could not be brought into a post'));
        return;
      }
      if (body.upload) {
        setFromStudio({
          key: body.upload.key,
          url: body.upload.url,
          outputId: body.sourceOutputId,
        });
        setPreview(body.upload.url);
      }
      // The caption the Studio wrote, unless something is already being written here.
      if (body.text) setText((current) => (current.trim() ? current : (body.text ?? '')));
    };
    void run();
    return () => {
      stopped = true;
    };
  }, [base]);

  // Poll the publication until no target is still in flight.
  useEffect(() => {
    if (!publicationId) return;
    let stopped = false;
    const tick = async () => {
      // A failed poll is retried: the worker carries on regardless of this page.
      const response = await fetch(`${base}/publications/${publicationId}`).catch(() => null);
      if (stopped) return;
      if (!response?.ok) {
        setTimeout(() => void tick(), 3000);
        return;
      }
      const { publication } = (await response.json()) as {
        publication: { targets: TargetView[] };
      };
      setTargets(publication.targets);
      // A post waiting for its slot is checked every half minute rather than every two
      // seconds: it may be days away, and this page may be open the whole time. Same for a
      // target backing off, which comes back in minutes, not seconds.
      const waiting = publication.targets.some((t) => IN_FLIGHT.has(t.status));
      const later = scheduledAt !== null && new Date(scheduledAt) > new Date();
      const again = publication.targets.some((t) => COMING_BACK.has(t.status));
      if (waiting && !later) setTimeout(() => void tick(), 2000);
      else if (later || again) setTimeout(() => void tick(), 30_000);
    };
    void tick();
    return () => {
      stopped = true;
    };
  }, [base, publicationId, scheduledAt]);

  function chooseFile(next: File | null) {
    if (next && !['image/jpeg', 'image/png'].includes(next.type)) {
      setError('Use a JPEG or PNG image.');
      return;
    }
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    previewRef.current = next ? URL.createObjectURL(next) : null;
    setFile(next);
    setPreview(previewRef.current);
    setError(null);
    if (!next && fileInput.current) fileInput.current.value = '';
  }

  function onDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    setDragging(false);
    const dropped = event.dataTransfer.files[0];
    if (dropped) chooseFile(dropped);
  }

  function toggle(id: string) {
    setChosen((current) =>
      current.includes(id) ? current.filter((c) => c !== id) : [...current, id],
    );
  }

  /** Puts text at the cursor, keeping the cursor after it. */
  function insert(snippet: string) {
    const area = editor.current;
    const start = area?.selectionStart ?? text.length;
    const end = area?.selectionEnd ?? text.length;
    setText(text.slice(0, start) + snippet + text.slice(end));
    requestAnimationFrame(() => {
      area?.focus();
      area?.setSelectionRange(start + snippet.length, start + snippet.length);
    });
  }

  function addHashtag(tag: string) {
    const needsSpace = text.length > 0 && !/\s$/.test(text);
    setText(`${text}${needsSpace ? ' ' : ''}${tag} `);
    editor.current?.focus();
  }

  function saveNow() {
    const draft = { text, chosen, frame, savedAt: new Date().toISOString() };
    if (writeDraft(workspaceId, draft)) {
      setSavedAt(draft.savedAt);
      toast({ tone: 'neutral', message: 'Draft saved on this device.' });
    }
  }

  async function post() {
    setError(null);
    try {
      let mediaKey: string | undefined = fromStudio?.key;
      if (file) {
        setBusy('uploading');
        const form = new FormData();
        form.set('file', file);
        const uploaded = await fetch(`${base}/uploads`, { method: 'POST', body: form });
        const body = (await uploaded.json()) as ApiError & { upload?: { key: string } };
        if (!uploaded.ok || !body.upload) {
          setError(describe(body, 'The image could not be uploaded'));
          return;
        }
        mediaKey = body.upload.key;
      }

      setBusy('posting');
      const response = await fetch(`${base}/publications`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          text,
          accountIds: chosen,
          ...(mediaKey ? { mediaKey, instagramFrame: frame } : {}),
          ...(fromStudio ? { sourceOutputId: fromStudio.outputId } : {}),
          ...(whenValid && whenAt ? { scheduledAt: whenAt.toISOString() } : {}),
        }),
      });
      const body = (await response.json()) as ApiError & {
        publicationId?: string;
        scheduledAt?: string | null;
      };
      if (!response.ok || !body.publicationId) {
        setError(describe(body, 'The post could not be sent'));
        return;
      }
      writeDraft(workspaceId, null);
      setSavedAt(null);
      setTargets([]);
      setScheduledAt(body.scheduledAt ?? null);
      setPublicationId(body.publicationId);
      // The outcome, said once, where the eye already is (WP51). The status below keeps
      // following it; this is the moment it changed.
      toast({
        tone: 'good',
        message: body.scheduledAt
          ? `Scheduled for ${new Date(body.scheduledAt).toLocaleString('en-IN', {
              day: 'numeric',
              month: 'short',
              hour: '2-digit',
              minute: '2-digit',
            })}.`
          : 'Handed to the worker. The sync centre shows what the platform says.',
      });
    } catch {
      setError('Something went wrong on the way. Check your connection and try again.');
    } finally {
      setBusy(null);
    }
  }

  function startOver() {
    setText('');
    chooseFile(null);
    setChosen([]);
    setFrame('portrait');
    setPublicationId(null);
    setTargets([]);
    setWhen('');
    setScheduledAt(null);
    setFromStudio(null);
  }

  if (accounts.length === 0) {
    return (
      <section className="rounded-2xl border border-line bg-surface px-6 py-8">
        <h1 className="text-title font-display font-semibold text-ink">Create post</h1>
        <p className="mt-2 max-w-prose text-sm text-muted">
          Connect Instagram or LinkedIn first. Until the connect flow exists, run{' '}
          <code className="text-ink">pnpm --filter @cgp/worker accounts:import</code> with this
          workspace&apos;s id.
        </p>
        <Link href={`/w/${workspaceId}/accounts`} className="mt-4 inline-block text-sm text-accent">
          Go to Accounts
        </Link>
      </section>
    );
  }

  const suggestions = hashtags.filter((tag) => !text.toLowerCase().includes(tag.toLowerCase()));
  const pendingSchedule = scheduledAt !== null && new Date(scheduledAt) > new Date();
  const done =
    targets.length > 0 &&
    !pendingSchedule &&
    !targets.some((t) => IN_FLIGHT.has(t.status) || COMING_BACK.has(t.status));

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,42fr)_minmax(0,58fr)]">
      {/* Left: creation and controls. */}
      <section className="flex flex-col rounded-2xl border border-line bg-surface">
        <header className="flex items-center justify-between gap-3 px-6 pt-5">
          <h1 className="text-title font-display font-semibold text-ink">Create post</h1>
          <span className="text-xs text-muted" aria-live="polite">
            {publicationId
              ? pendingSchedule
                ? 'Scheduled'
                : 'Sent'
              : savedAt
                ? `Draft saved · ${clock(savedAt)}`
                : 'Drafts save as you type'}
          </span>
        </header>

        {publicationId ? (
          <div className="flex flex-col gap-3 px-6 py-5">
            <p className="text-sm text-muted">
              {pendingSchedule && scheduledAt
                ? `Scheduled for ${fullClock(scheduledAt)}. It goes out on its own; you can close this.`
                : done
                  ? 'Finished. Each account published on its own.'
                  : 'Publishing. Each account goes on its own, so one can succeed while another fails.'}
            </p>
            {targets.length === 0 ? (
              <p className="text-sm text-muted">{pendingSchedule ? 'Waiting…' : 'Queued…'}</p>
            ) : null}
            {targets.map((target) => (
              <div
                key={target.id}
                className="flex flex-col gap-2 rounded-xl border border-line bg-raised px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-ink">{NAMES[target.platform]}</p>
                  <p className="truncate text-xs text-muted">{target.account}</p>
                  {target.error ? (
                    <p className="mt-1 text-xs text-bad">{target.error.message}</p>
                  ) : null}
                </div>
                <div className="flex items-center gap-3">
                  {target.permalink ? (
                    <a
                      href={target.permalink}
                      target="_blank"
                      rel="noreferrer"
                      className="text-sm text-accent hover:underline"
                    >
                      View post
                    </a>
                  ) : null}
                  <Badge tone={STATUS_BADGE[target.status]}>{STATUS_TEXT[target.status]}</Badge>
                </div>
              </div>
            ))}
            {done ? (
              <Button variant="secondary" onClick={startOver} className="w-full">
                Write another post
              </Button>
            ) : null}
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-5 px-6 py-5">
              {/* 1. Where it goes. */}
              <div className="flex flex-col gap-2">
                <span className="text-xs font-medium uppercase tracking-wide text-muted">
                  Post to
                </span>
                <div className="flex flex-wrap gap-2">
                  {accounts.map((account) => {
                    const on = chosen.includes(account.id);
                    return (
                      <button
                        key={account.id}
                        type="button"
                        aria-pressed={on}
                        title={
                          account.sharedDemo
                            ? `${account.displayName} — the team's own account, borrowed`
                            : account.displayName
                        }
                        onClick={() => toggle(account.id)}
                        className={cx(
                          'tap-target flex h-10 cursor-pointer items-center gap-2 rounded-full border pl-1.5 pr-3.5 text-sm transition',
                          on
                            ? 'border-accent bg-accent/10 text-ink'
                            : 'border-line bg-raised text-muted hover:border-faint hover:text-ink',
                        )}
                      >
                        <span className={cx('h-7 w-7 rounded-full p-[2px]', DOT[account.platform])}>
                          <span className="flex h-full w-full items-center justify-center rounded-full bg-surface text-[11px] font-semibold text-ink">
                            {on
                              ? '✓'
                              : account.displayName.replace(/^@/, '').charAt(0).toUpperCase()}
                          </span>
                        </span>
                        {NAMES[account.platform]}
                        {account.sharedDemo ? <span className="text-faint">(demo)</span> : null}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* 2. What it says. */}
              <div className="flex flex-col gap-2">
                <label
                  htmlFor="post-text"
                  className="text-xs font-medium uppercase tracking-wide text-muted"
                >
                  Text
                </label>
                <div className="rounded-xl border border-line bg-raised transition focus-within:border-accent/70 focus-within:ring-2 focus-within:ring-accent/15">
                  <textarea
                    id="post-text"
                    ref={editor}
                    value={text}
                    onChange={(event) => setText(event.target.value)}
                    rows={9}
                    placeholder="What do you want to say?"
                    className="block w-full resize-y rounded-t-xl bg-transparent px-4 py-3 text-[15px] leading-6 text-ink outline-none placeholder:text-faint"
                  />
                  <div className="relative flex items-center gap-1 border-t border-line px-2 py-1.5">
                    <button
                      type="button"
                      onClick={() => setEmojiOpen((open) => !open)}
                      aria-expanded={emojiOpen}
                      className="tap-target flex h-8 cursor-pointer items-center gap-1.5 rounded-lg px-2 text-sm text-muted transition hover:bg-surface hover:text-ink"
                    >
                      <SmileIcon width={16} height={16} aria-hidden /> Emoji
                    </button>
                    <button
                      type="button"
                      onClick={() => insert('#')}
                      className="tap-target flex h-8 cursor-pointer items-center rounded-lg px-2 text-sm text-muted transition hover:bg-surface hover:text-ink"
                    >
                      # Hashtag
                    </button>
                    {emojiOpen ? (
                      <div className="absolute bottom-11 left-2 z-20 grid w-72 grid-cols-8 gap-1 rounded-xl border border-line bg-raised p-2 shadow-2xl">
                        {EMOJIS.map((emoji) => (
                          <button
                            key={emoji}
                            type="button"
                            aria-label={`Insert ${emoji}`}
                            onClick={() => {
                              insert(emoji);
                              setEmojiOpen(false);
                            }}
                            className="tap-target flex h-8 cursor-pointer items-center justify-center rounded-lg text-lg hover:bg-surface"
                          >
                            {emoji}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>

                {suggestions.length > 0 ? (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-xs text-muted">From your pillars:</span>
                    {suggestions.map((tag) => (
                      <button
                        key={tag}
                        type="button"
                        onClick={() => addHashtag(tag)}
                        className="tap-target cursor-pointer rounded-full border border-line px-2.5 py-1 text-xs text-ink transition hover:border-accent/60"
                      >
                        {tag}
                      </button>
                    ))}
                  </div>
                ) : null}

                {text.trim().length >= 10 ? (
                  <div className="flex flex-col gap-2 rounded-xl border border-line bg-raised p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-1.5 text-xs font-medium text-muted">
                        <TrendIcon width={14} height={14} aria-hidden className="text-faint" />
                        Trend fit
                      </span>
                      {fitLoading ? (
                        <span className="text-xs text-faint">Checking…</span>
                      ) : fit ? (
                        <span
                          className={cx(
                            'rounded-md px-2 py-0.5 text-xs font-semibold font-mono tabular-nums',
                            fit.score >= 60
                              ? 'bg-good/10 text-good'
                              : fit.score >= 25
                                ? 'bg-hot/10 text-hot'
                                : 'bg-raised text-faint',
                          )}
                        >
                          {fit.score}/100
                        </span>
                      ) : null}
                    </div>

                    {!fitLoading && fit && fit.matches.length > 0 ? (
                      <>
                        <p className="text-xs text-muted">
                          Closest to{' '}
                          <span className="text-ink">{fit.matches[0]!.topicTitle}</span> (
                          {fit.matches[0]!.niche}, rising {fit.matches[0]!.velocityScore}/100).
                          Not a virality score — just how much of that topic&apos;s own language
                          this already uses.
                        </p>
                        {fit.suggestedKeywords.length > 0 ? (
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="text-xs text-muted">Keywords:</span>
                            {fit.suggestedKeywords.map((k) => (
                              <button
                                key={k}
                                type="button"
                                onClick={() => insert(k)}
                                className="tap-target cursor-pointer rounded-full border border-line px-2.5 py-1 text-xs text-ink transition hover:border-accent/60"
                              >
                                {k}
                              </button>
                            ))}
                          </div>
                        ) : null}
                        {fit.suggestedHashtags.length > 0 ? (
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="text-xs text-muted">Hashtags:</span>
                            {fit.suggestedHashtags.map((tag) => (
                              <button
                                key={tag}
                                type="button"
                                onClick={() => addHashtag(tag)}
                                className="tap-target cursor-pointer rounded-full border border-line px-2.5 py-1 text-xs text-ink transition hover:border-accent/60"
                              >
                                {tag}
                              </button>
                            ))}
                          </div>
                        ) : null}
                      </>
                    ) : !fitLoading ? (
                      <p className="text-xs text-faint">
                        Nothing on Trend Radar overlaps with this yet. Check the Trends page for
                        angles in your niche, or this may just not be a trend-driven post.
                      </p>
                    ) : null}
                  </div>
                ) : null}

                <div className="flex flex-wrap gap-2">
                  {(platforms.length > 0 ? platforms : previewPlatforms).map((p) => {
                    const ratio = text.length / LIMITS[p];
                    return (
                      <span
                        key={p}
                        className={cx(
                          'rounded-md border px-2 py-0.5 text-xs font-medium font-mono tabular-nums',
                          ratio > 1
                            ? 'border-bad/50 bg-bad/10 text-bad'
                            : ratio > 0.9
                              ? 'border-hot/50 bg-hot/10 text-hot'
                              : 'border-good/40 bg-good/10 text-good',
                        )}
                      >
                        {SHORT[p]} {text.length.toLocaleString('en-IN')} /{' '}
                        {LIMITS[p].toLocaleString('en-IN')}
                      </span>
                    );
                  })}
                </div>
              </div>

              {/* 3. The image. */}
              <div className="flex flex-col gap-2">
                <span className="text-xs font-medium uppercase tracking-wide text-muted">
                  Media
                </span>
                <input
                  ref={fileInput}
                  type="file"
                  accept="image/jpeg,image/png"
                  onChange={(event: ChangeEvent<HTMLInputElement>) =>
                    chooseFile(event.target.files?.[0] ?? null)
                  }
                  className="sr-only"
                  id="post-media"
                />
                {busy === 'attaching' ? (
                  <div className="flex items-center gap-3 rounded-xl border border-line bg-raised p-2.5">
                    <span className="size-16 shrink-0 animate-pulse rounded-lg bg-surface" />
                    <p className="text-sm text-muted">Bringing the picture in from the Studio…</p>
                  </div>
                ) : (file || fromStudio) && preview ? (
                  <div className="flex items-center gap-3 rounded-xl border border-line bg-raised p-2.5">
                    {/* A local object URL: next/image cannot optimise it, and need not. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={preview}
                      alt="Selected image"
                      className="h-16 w-16 shrink-0 rounded-lg object-cover"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-ink">
                        {file ? file.name : 'From the Studio'}
                      </p>
                      <p className="text-xs text-muted">
                        {file
                          ? `${(file.size / 1024 / 1024).toFixed(1)} MB`
                          : 'Cut to each platform, ready to post'}
                      </p>
                    </div>
                    <label
                      htmlFor="post-media"
                      className="cursor-pointer rounded-lg px-2.5 py-1.5 text-sm text-muted hover:bg-surface hover:text-ink"
                    >
                      Replace
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        setFromStudio(null);
                        chooseFile(null);
                      }}
                      className="rounded-lg px-2.5 py-1.5 text-sm text-muted hover:bg-surface hover:text-bad"
                    >
                      Remove
                    </button>
                  </div>
                ) : (
                  <label
                    htmlFor="post-media"
                    onDragOver={(event) => {
                      event.preventDefault();
                      setDragging(true);
                    }}
                    onDragLeave={() => setDragging(false)}
                    onDrop={onDrop}
                    className={cx(
                      'flex cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed px-4 py-7 text-center transition',
                      dragging
                        ? 'border-accent bg-accent/5'
                        : 'border-line hover:border-faint hover:bg-raised',
                    )}
                  >
                    <span className="text-sm font-medium text-ink">
                      Drop an image, or <span className="text-accent">browse</span>
                    </span>
                    <span className="text-xs text-muted">JPEG or PNG, up to 8 MB</span>
                  </label>
                )}

                {hasImage && platforms.includes('instagram') ? (
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-xs text-muted">Instagram frame</span>
                    <SegmentedControl
                      name="instagram-frame"
                      label="Instagram frame"
                      value={frame}
                      onChange={setFrame}
                      options={[
                        { value: 'portrait', label: '4:5 Portrait' },
                        { value: 'square', label: '1:1 Square' },
                      ]}
                    />
                  </div>
                ) : null}
              </div>
            </div>

            {/* Pinned actions: always reachable without scrolling back. */}
            <footer className="sticky bottom-0 flex flex-col gap-3 rounded-b-2xl border-t border-line bg-surface/95 px-6 py-4 backdrop-blur">
              {error ? <p className="text-sm text-bad">{error}</p> : null}
              {!live ? (
                <p className="text-xs text-muted">
                  Practice mode: publishing is faked, nothing leaves this machine.
                </p>
              ) : usingSharedDemo ? (
                // live is true here, so this really leaves the machine: the loudest version
                // of the warning belongs at the moment of sending, not only on Accounts.
                <p className="rounded-lg border border-hot/40 bg-hot/5 px-3 py-2 text-xs leading-5 text-ink">
                  This sends from the team&apos;s own account, for real, visible to the public.
                  Nothing private, nothing you would not want attached to it.
                </p>
              ) : null}
              <div className="flex gap-2">
                <Button variant="secondary" onClick={saveNow} className="flex-1">
                  Save draft
                </Button>
                <Button
                  variant="secondary"
                  className="flex-1"
                  aria-pressed={when !== ''}
                  onClick={() => setWhen(when ? '' : defaultSchedule())}
                >
                  {when ? 'Post now instead' : 'Schedule'}
                </Button>
              </div>
              {when ? (
                <label className="flex flex-col gap-1.5 text-xs text-muted">
                  Goes out at
                  <input
                    type="datetime-local"
                    value={when}
                    min={localInputValue(new Date())}
                    onChange={(event) => setWhen(event.target.value)}
                    className="rounded-lg border border-line bg-raised px-3 py-2 text-sm text-ink [color-scheme:dark]"
                  />
                  {when && !whenValid ? (
                    <span className="text-bad">Pick a time in the future.</span>
                  ) : (
                    <span>Your time. The worker checks every fifteen seconds.</span>
                  )}
                </label>
              ) : null}
              <Button onClick={() => void post()} disabled={!canPost} className="w-full">
                {busy === 'uploading'
                  ? 'Uploading…'
                  : busy === 'posting'
                    ? when
                      ? 'Scheduling…'
                      : 'Posting…'
                    : when
                      ? whenValid && whenAt
                        ? `Schedule for ${fullClock(whenAt.toISOString())}`
                        : 'Schedule'
                      : live
                        ? 'Post now'
                        : 'Post now (practice)'}
              </Button>
            </footer>
          </>
        )}
      </section>

      {/* Right: the live preview, pinned while the left side scrolls. */}
      <aside className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-5 lg:sticky lg:top-20">
        <div className="flex items-center justify-between gap-3">
          {/* The hand-rolled strip had no arrow keys and put every tab in the tab order; the
              library's does both properly (WP43). */}
          {activeTab ? (
            <Tabs
              label="Preview"
              value={activeTab}
              onChange={setTab}
              options={previewPlatforms.map((p) => ({ value: p, label: NAMES[p] }))}
            />
          ) : null}
          <span className="text-xs text-muted">
            {selected.length === 0 ? 'Nothing selected yet' : 'Live preview'}
          </span>
        </div>

        {activeTab === 'instagram' ? (
          hasImage ? (
            <Note tone="info">
              Fitted to {frame === 'portrait' ? '4:5' : '1:1'} with bars in your brand colour.
              Nothing is cropped.
            </Note>
          ) : (
            <Note tone="warn">Instagram needs an image.</Note>
          )
        ) : activeTab === 'linkedin' ? (
          <Note tone="info">
            {hasImage
              ? 'The image goes out as uploaded, at its own shape.'
              : 'A text post. Adding an image is optional.'}
          </Note>
        ) : null}
        {activeTab && text.length > LIMITS[activeTab] ? (
          <Note tone="bad">
            {(text.length - LIMITS[activeTab]).toLocaleString('en-IN')} characters over the{' '}
            {NAMES[activeTab]} limit.
          </Note>
        ) : null}

        <div className="flex min-h-[420px] justify-center rounded-xl bg-canvas px-4 py-6">
          {activeAccount?.platform === 'instagram' ? (
            <InstagramPost
              username={activeAccount.displayName}
              text={text}
              image={preview}
              barColour={barColour}
              frame={frame}
            />
          ) : activeAccount ? (
            <LinkedInPost name={activeAccount.displayName} text={text} image={preview} />
          ) : null}
        </div>
      </aside>
    </div>
  );
}
