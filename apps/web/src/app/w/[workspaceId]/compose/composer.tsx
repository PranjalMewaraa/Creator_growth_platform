'use client';

import type { PostTargetStatus, TargetPlatform } from '@cgp/contracts';
import { Button, cx } from '@cgp/ui';
import Link from 'next/link';
import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type ReactNode,
} from 'react';
import { InstagramPost, LinkedInPost } from './post-previews';

// Split pane (Buffer, Typefully style): compose on the left, a pinned live preview on the
// right. Choose where, then write; the actions stay pinned under the editor.

export interface ComposerAccount {
  id: string;
  platform: TargetPlatform;
  displayName: string;
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

const LIMITS: Record<TargetPlatform, number> = { instagram: 2200, linkedin: 3000 };
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

/** Statuses the worker is still working through; anything else is where this attempt ended. */
const IN_FLIGHT: ReadonlySet<PostTargetStatus> = new Set(['pending', 'claimed']);

const STATUS_TEXT: Record<PostTargetStatus, string> = {
  pending: 'Waiting',
  claimed: 'Publishing',
  published: 'Published',
  retry_scheduled: 'Not sent, can retry',
  quota_wait: 'Platform limit reached',
  reauth_required: 'Reconnect the account',
  failed: 'Failed',
  needs_verification: 'Check the account',
};

const STATUS_TONE: Record<PostTargetStatus, string> = {
  pending: 'text-muted border-line',
  claimed: 'text-accent border-accent/50',
  published: 'text-good border-good/50',
  retry_scheduled: 'text-hot border-hot/50',
  quota_wait: 'text-hot border-hot/50',
  reauth_required: 'text-bad border-bad/50',
  failed: 'text-bad border-bad/50',
  needs_verification: 'text-hot border-hot/50',
};

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

function Badge({ tone, children }: { tone: 'info' | 'warn' | 'bad'; children: ReactNode }) {
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
  const [dragging, setDragging] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [tab, setTab] = useState<TargetPlatform | null>(null);
  const [busy, setBusy] = useState<'uploading' | 'posting' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [publicationId, setPublicationId] = useState<string | null>(null);
  const [targets, setTargets] = useState<TargetView[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);
  const editor = useRef<HTMLTextAreaElement>(null);
  const previewRef = useRef<string | null>(null);

  const base = `/api/w/${workspaceId}`;
  const selected = accounts.filter((a) => chosen.includes(a.id));
  const platforms = [...new Set(selected.map((a) => a.platform))];
  const imageMissing = platforms.includes('instagram') && !file;
  const over = platforms.filter((p) => text.length > LIMITS[p]);
  const canPost =
    busy === null &&
    chosen.length > 0 &&
    (text.trim().length > 0 || file !== null) &&
    !imageMissing &&
    over.length === 0;

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

  // Release the last preview's memory when the composer goes away.
  useEffect(
    () => () => {
      if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    },
    [],
  );

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
      if (publication.targets.some((t) => IN_FLIGHT.has(t.status))) {
        setTimeout(() => void tick(), 2000);
      }
    };
    void tick();
    return () => {
      stopped = true;
    };
  }, [base, publicationId]);

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
    if (writeDraft(workspaceId, draft)) setSavedAt(draft.savedAt);
  }

  async function post() {
    setError(null);
    try {
      let mediaKey: string | undefined;
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
        }),
      });
      const body = (await response.json()) as ApiError & { publicationId?: string };
      if (!response.ok || !body.publicationId) {
        setError(describe(body, 'The post could not be sent'));
        return;
      }
      writeDraft(workspaceId, null);
      setSavedAt(null);
      setTargets([]);
      setPublicationId(body.publicationId);
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
  }

  if (accounts.length === 0) {
    return (
      <section className="rounded-2xl border border-line bg-surface px-6 py-8">
        <h1 className="text-xl font-semibold text-ink">Create post</h1>
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
  const done = targets.length > 0 && !targets.some((t) => IN_FLIGHT.has(t.status));

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,42fr)_minmax(0,58fr)]">
      {/* Left: creation and controls. */}
      <section className="flex flex-col rounded-2xl border border-line bg-surface">
        <header className="flex items-center justify-between gap-3 px-6 pt-5">
          <h1 className="text-xl font-semibold tracking-tight text-ink">Create post</h1>
          <span className="text-xs text-muted" aria-live="polite">
            {publicationId
              ? 'Sent'
              : savedAt
                ? `Draft saved · ${clock(savedAt)}`
                : 'Drafts save as you type'}
          </span>
        </header>

        {publicationId ? (
          <div className="flex flex-col gap-3 px-6 py-5">
            <p className="text-sm text-muted">
              {done
                ? 'Finished. Each account published on its own.'
                : 'Publishing. Each account goes on its own, so one can succeed while another fails.'}
            </p>
            {targets.length === 0 ? <p className="text-sm text-muted">Queued…</p> : null}
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
                  <span
                    className={cx(
                      'rounded-full border px-3 py-1 text-xs',
                      STATUS_TONE[target.status],
                    )}
                  >
                    {STATUS_TEXT[target.status]}
                  </span>
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
                        title={account.displayName}
                        onClick={() => toggle(account.id)}
                        className={cx(
                          'flex h-10 items-center gap-2 rounded-full border pl-1.5 pr-3.5 text-sm transition',
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
                      className="flex h-8 items-center gap-1.5 rounded-lg px-2 text-sm text-muted transition hover:bg-surface hover:text-ink"
                    >
                      <span aria-hidden>😊</span> Emoji
                    </button>
                    <button
                      type="button"
                      onClick={() => insert('#')}
                      className="flex h-8 items-center rounded-lg px-2 text-sm text-muted transition hover:bg-surface hover:text-ink"
                    >
                      # Hashtag
                    </button>
                    {emojiOpen ? (
                      <div className="absolute bottom-11 left-2 z-20 grid w-72 grid-cols-8 gap-1 rounded-xl border border-line bg-raised p-2 shadow-2xl">
                        {EMOJIS.map((emoji) => (
                          <button
                            key={emoji}
                            type="button"
                            onClick={() => {
                              insert(emoji);
                              setEmojiOpen(false);
                            }}
                            className="flex h-8 items-center justify-center rounded-lg text-lg hover:bg-surface"
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
                        className="rounded-full border border-line px-2.5 py-1 text-xs text-ink transition hover:border-accent/60"
                      >
                        {tag}
                      </button>
                    ))}
                  </div>
                ) : null}

                <div className="flex flex-wrap gap-2">
                  {(platforms.length > 0 ? platforms : previewPlatforms).map((p) => {
                    const ratio = text.length / LIMITS[p];
                    return (
                      <span
                        key={p}
                        className={cx(
                          'rounded-md border px-2 py-0.5 text-xs font-medium tabular-nums',
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
                {file && preview ? (
                  <div className="flex items-center gap-3 rounded-xl border border-line bg-raised p-2.5">
                    {/* A local object URL: next/image cannot optimise it, and need not. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={preview}
                      alt="Selected image"
                      className="h-16 w-16 shrink-0 rounded-lg object-cover"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-ink">{file.name}</p>
                      <p className="text-xs text-muted">
                        {(file.size / 1024 / 1024).toFixed(1)} MB
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
                      onClick={() => chooseFile(null)}
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

                {file && platforms.includes('instagram') ? (
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-xs text-muted">Instagram frame</span>
                    <div className="flex rounded-lg border border-line bg-raised p-0.5">
                      {(['portrait', 'square'] as const).map((f) => (
                        <button
                          key={f}
                          type="button"
                          aria-pressed={frame === f}
                          onClick={() => setFrame(f)}
                          className={cx(
                            'rounded-md px-3 py-1 text-xs transition',
                            frame === f
                              ? 'bg-ink font-medium text-canvas'
                              : 'text-muted hover:text-ink',
                          )}
                        >
                          {f === 'portrait' ? '4:5 Portrait' : '1:1 Square'}
                        </button>
                      ))}
                    </div>
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
              ) : null}
              <div className="flex gap-2">
                <Button variant="secondary" onClick={saveNow} className="flex-1">
                  Save draft
                </Button>
                <Button
                  variant="secondary"
                  disabled
                  className="flex-1"
                  title="Scheduling arrives with the calendar"
                >
                  Schedule
                  <span className="rounded-full bg-raised px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted">
                    Soon
                  </span>
                </Button>
              </div>
              <Button onClick={() => void post()} disabled={!canPost} className="w-full">
                {busy === 'uploading'
                  ? 'Uploading…'
                  : busy === 'posting'
                    ? 'Posting…'
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
          <div
            role="tablist"
            aria-label="Preview"
            className="flex rounded-lg border border-line bg-raised p-0.5"
          >
            {previewPlatforms.map((p) => (
              <button
                key={p}
                type="button"
                role="tab"
                aria-selected={activeTab === p}
                onClick={() => setTab(p)}
                className={cx(
                  'rounded-md px-4 py-1.5 text-sm transition',
                  activeTab === p ? 'bg-ink font-medium text-canvas' : 'text-muted hover:text-ink',
                )}
              >
                {NAMES[p]}
              </button>
            ))}
          </div>
          <span className="text-xs text-muted">
            {selected.length === 0 ? 'Nothing selected yet' : 'Live preview'}
          </span>
        </div>

        {activeTab === 'instagram' ? (
          file ? (
            <Badge tone="info">
              Fitted to {frame === 'portrait' ? '4:5' : '1:1'} with bars in your brand colour.
              Nothing is cropped.
            </Badge>
          ) : (
            <Badge tone="warn">Instagram needs an image.</Badge>
          )
        ) : activeTab === 'linkedin' ? (
          <Badge tone="info">
            {file
              ? 'The image goes out as uploaded, at its own shape.'
              : 'A text post. Adding an image is optional.'}
          </Badge>
        ) : null}
        {activeTab && text.length > LIMITS[activeTab] ? (
          <Badge tone="bad">
            {(text.length - LIMITS[activeTab]).toLocaleString('en-IN')} characters over the{' '}
            {NAMES[activeTab]} limit.
          </Badge>
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
