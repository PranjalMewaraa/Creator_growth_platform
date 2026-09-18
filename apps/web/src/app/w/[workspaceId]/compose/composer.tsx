'use client';

import type { PostTargetStatus, TargetPlatform } from '@cgp/contracts';
import { Button, Card, CardBody, CardHeader, cx, EmptyState } from '@cgp/ui';
import Link from 'next/link';
import { useEffect, useRef, useState, type ChangeEvent } from 'react';

interface Account {
  id: string;
  platform: TargetPlatform;
  displayName: string;
}

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

const LIMITS: Record<TargetPlatform, number> = { instagram: 2200, linkedin: 3000 };
const NAMES: Record<TargetPlatform, string> = { instagram: 'Instagram', linkedin: 'LinkedIn' };

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
  claimed: 'text-accent border-accent/40',
  published: 'text-good border-good/40',
  retry_scheduled: 'text-hot border-hot/40',
  quota_wait: 'text-hot border-hot/40',
  reauth_required: 'text-bad border-bad/40',
  failed: 'text-bad border-bad/40',
  needs_verification: 'text-hot border-hot/40',
};

function describe(body: ApiError, fallback: string): string {
  const error = body.error;
  if (error?.issues?.length) return error.issues.map((i) => i.message).join('. ');
  if (error?.code === 'blocked') return `Blocked by moderation (${error.category ?? 'policy'}).`;
  if (error?.code === 'moderation_unavailable') return 'Moderation is unavailable; try again.';
  return error?.code ? `${fallback} (${error.code})` : fallback;
}

export function Composer({
  workspaceId,
  accounts,
  live,
}: {
  workspaceId: string;
  accounts: Account[];
  live: boolean;
}) {
  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [chosen, setChosen] = useState<string[]>([]);
  const [busy, setBusy] = useState<'uploading' | 'posting' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [publicationId, setPublicationId] = useState<string | null>(null);
  const [targets, setTargets] = useState<TargetView[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);

  const base = `/api/w/${workspaceId}`;
  const platforms = [
    ...new Set(accounts.filter((a) => chosen.includes(a.id)).map((a) => a.platform)),
  ];
  const needsJpeg = platforms.includes('instagram');
  const jpegProblem = needsJpeg && (!file || file.type !== 'image/jpeg');
  const tooLong = platforms.filter((p) => text.length > LIMITS[p]);
  const canPost =
    busy === null &&
    chosen.length > 0 &&
    (text.trim().length > 0 || file !== null) &&
    !jpegProblem &&
    tooLong.length === 0;

  // Release the last preview's memory when the composer goes away.
  const previewRef = useRef<string | null>(null);
  useEffect(
    () => () => {
      if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    },
    [],
  );

  function chooseFile(next: File | null) {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    previewRef.current = next ? URL.createObjectURL(next) : null;
    setFile(next);
    setPreview(previewRef.current);
    if (!next && fileInput.current) fileInput.current.value = '';
  }

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

  function pickFile(event: ChangeEvent<HTMLInputElement>) {
    chooseFile(event.target.files?.[0] ?? null);
    setError(null);
  }

  function toggle(id: string) {
    setChosen((current) =>
      current.includes(id) ? current.filter((c) => c !== id) : [...current, id],
    );
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
        body: JSON.stringify({ text, accountIds: chosen, ...(mediaKey ? { mediaKey } : {}) }),
      });
      const body = (await response.json()) as ApiError & { publicationId?: string };
      if (!response.ok || !body.publicationId) {
        setError(describe(body, 'The post could not be sent'));
        return;
      }
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
    setPublicationId(null);
    setTargets([]);
  }

  if (accounts.length === 0) {
    return (
      <Card>
        <EmptyState
          title="No accounts connected"
          description="Connect Instagram or LinkedIn first. Until the connect flow exists, run pnpm --filter @cgp/worker accounts:import with this workspace's id."
          action={
            <Link href={`/w/${workspaceId}/accounts`} className="text-sm text-accent">
              Go to Accounts
            </Link>
          }
        />
      </Card>
    );
  }

  if (publicationId) {
    const done = targets.length > 0 && !targets.some((t) => IN_FLIGHT.has(t.status));
    return (
      <Card>
        <CardHeader
          title={done ? 'Finished' : 'Publishing'}
          note="Each account publishes on its own, so one can succeed while another fails."
        />
        <CardBody className="flex flex-col gap-3">
          {targets.length === 0 ? <p className="text-sm text-muted">Queued…</p> : null}
          {targets.map((target) => (
            <div
              key={target.id}
              className="flex flex-col gap-2 rounded-xl border border-line bg-raised px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium text-ink">{NAMES[target.platform]}</p>
                <p className="truncate text-xs text-faint">{target.account}</p>
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
            <div className="pt-2">
              <Button variant="secondary" onClick={startOver}>
                Write another post
              </Button>
            </div>
          ) : null}
        </CardBody>
      </Card>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      <Card>
        <CardHeader
          title="Post"
          note={
            live
              ? 'Live: this publishes publicly on the accounts you pick.'
              : 'Practice mode: publishing is faked, nothing leaves this machine.'
          }
        />
        <CardBody className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="post-text" className="text-sm font-medium text-muted">
              Text
            </label>
            <textarea
              id="post-text"
              value={text}
              onChange={(event) => setText(event.target.value)}
              rows={8}
              placeholder="What do you want to say?"
              className="w-full resize-y rounded-xl border border-line bg-raised px-4 py-3 text-sm text-ink outline-none transition placeholder:text-faint focus:border-accent/70 focus:ring-2 focus:ring-accent/15"
            />
            <div className="flex flex-wrap gap-3 text-xs">
              {(platforms.length > 0 ? platforms : (['instagram', 'linkedin'] as const)).map(
                (p) => (
                  <span key={p} className={text.length > LIMITS[p] ? 'text-bad' : 'text-faint'}>
                    {NAMES[p]} {text.length.toLocaleString('en-IN')} /{' '}
                    {LIMITS[p].toLocaleString('en-IN')}
                  </span>
                ),
              )}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-muted">Image</span>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
              <label className="inline-flex h-11 w-fit cursor-pointer items-center rounded-xl border border-line bg-raised px-4 text-sm text-ink transition hover:border-faint">
                {file ? 'Change image' : 'Choose image'}
                <input
                  ref={fileInput}
                  type="file"
                  accept="image/jpeg,image/png"
                  onChange={pickFile}
                  className="sr-only"
                />
              </label>
              {file ? (
                <div className="flex items-start gap-3">
                  {preview ? (
                    // A local object URL: next/image cannot optimise it, and needs not.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={preview}
                      alt="Selected image"
                      className="h-24 w-24 rounded-xl border border-line object-cover"
                    />
                  ) : null}
                  <div className="text-xs text-faint">
                    <p className="text-ink">{file.name}</p>
                    <p>{(file.size / 1024 / 1024).toFixed(1)} MB</p>
                    <button
                      type="button"
                      onClick={() => chooseFile(null)}
                      className="mt-1 text-muted hover:text-ink"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
            <p className="text-xs text-faint">
              JPEG or PNG, up to 8 MB. Instagram needs a JPEG between 4:5 and 1.91:1.
            </p>
          </div>
        </CardBody>
      </Card>

      <Card className="h-fit">
        <CardHeader title="Where" />
        <CardBody className="flex flex-col gap-3">
          {accounts.map((account) => (
            <label
              key={account.id}
              className={cx(
                'flex cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 transition',
                chosen.includes(account.id)
                  ? 'border-accent/60 bg-accent/5'
                  : 'border-line bg-raised hover:border-faint',
              )}
            >
              <input
                type="checkbox"
                checked={chosen.includes(account.id)}
                onChange={() => toggle(account.id)}
                className="h-4 w-4 accent-[var(--color-accent)]"
              />
              <span className="min-w-0">
                <span className="block text-sm text-ink">{NAMES[account.platform]}</span>
                <span className="block truncate text-xs text-faint">{account.displayName}</span>
              </span>
            </label>
          ))}

          {jpegProblem && chosen.length > 0 ? (
            <p className="text-xs text-hot">Instagram needs a JPEG image.</p>
          ) : null}
          {error ? <p className="text-sm text-bad">{error}</p> : null}

          <Button onClick={() => void post()} disabled={!canPost}>
            {busy === 'uploading' ? 'Uploading…' : busy === 'posting' ? 'Posting…' : 'Post now'}
          </Button>
        </CardBody>
      </Card>
    </div>
  );
}
