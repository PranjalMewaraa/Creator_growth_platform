'use client';

import {
  countHashtags,
  PLATFORM_HASHTAG_LIMITS,
  PLATFORM_TEXT_LIMITS,
  type TargetPlatform,
  type TextLayerSpec,
} from '@cgp/contracts';
import { cx } from '@cgp/ui';
import { useState, type ReactNode } from 'react';
import { TextLayerEditor } from './text-layer-editor';

// A finished output, shaped by what the generator makes: a script reads as paragraphs, hooks
// and titles as lists, captions as one card per platform. Copy stays locked while checking.

/** Words a person speaks in a second, the same rate the compiler budgets scripts at. */
const WORDS_PER_SECOND = 2.5;

function words(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

/** Amber from nine tenths of the limit, red past it: the counter warns before it refuses. */
function tone(used: number, limit: number): string {
  if (used > limit) return 'text-bad';
  return used >= limit * 0.9 ? 'text-accent' : 'text-muted';
}

function Count({ used, limit, unit }: { used: number; limit: number; unit: string }) {
  return (
    <span className={cx('tabular-nums', tone(used, limit))}>
      {used.toLocaleString('en-IN')}/{limit.toLocaleString('en-IN')} {unit}
    </span>
  );
}

/**
 * What a caption costs against the platform it is for (S-11): characters against the
 * published limit and, where the platform counts them, hashtags. Both update as the text does.
 */
function CaptionMeter({ platform, text }: { platform: TargetPlatform; text: string }) {
  const limit = PLATFORM_TEXT_LIMITS[platform];
  const tags = PLATFORM_HASHTAG_LIMITS[platform];
  const tagsUsed = countHashtags(text);
  const over = text.length > limit || (tags !== undefined && tagsUsed > tags);
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
      <Count used={text.length} limit={limit} unit="characters" />
      {tags === undefined ? null : <Count used={tagsUsed} limit={tags} unit="hashtags" />}
      {over ? (
        <span className="text-bad">Too long to post as it is; trim it before publishing.</span>
      ) : null}
    </div>
  );
}

/**
 * Copying is how an output leaves the Studio, so it is also where it counts as accepted
 * (WP20): what was copied is compared with what the engine wrote, and the difference recorded.
 * Best effort, and never in the way of the copy itself.
 */
function recordAcceptance(accept: Accept | undefined, accepted: string): void {
  if (!accept) return;
  void fetch(`/api/w/${accept.workspaceId}/outputs/${accept.outputId}/accept`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ accepted, generated: accept.generated }),
  }).catch(() => undefined);
}

export interface Accept {
  workspaceId: string;
  outputId: string;
  /** The text the engine wrote, when the output holds several pieces. */
  generated?: string;
}

function CopyButton({ text, locked, accept }: { text: string; locked: boolean; accept?: Accept }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      disabled={locked}
      title={locked ? 'Available once the check passes' : 'Copy'}
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          recordAcceptance(accept, text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
      className="shrink-0 rounded-lg border border-line px-2.5 py-1 text-xs text-muted transition hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
    >
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

function Block({
  title,
  text,
  locked,
  meter,
  accept,
  children,
}: {
  title?: string;
  text: string;
  locked: boolean;
  /** A length indicator under the text, for the outputs that have a limit to meet. */
  meter?: ReactNode;
  accept?: Accept;
  children?: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-line bg-raised px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        {title ? (
          <p className="text-xs font-medium uppercase tracking-wide text-muted">{title}</p>
        ) : (
          <span />
        )}
        <CopyButton text={text} locked={locked} accept={accept} />
      </div>
      <div
        className={cx(
          'mt-2 whitespace-pre-wrap text-[15px] leading-7 text-ink',
          locked && 'opacity-80',
        )}
      >
        {children ?? text}
      </div>
      {meter}
    </div>
  );
}

/** A finished reel: watchable in place, at the shape it was rendered. */
export function VideoOutput({
  url,
  width,
  height,
}: {
  url: string;
  width: number;
  height: number;
}) {
  return (
    <figure className="overflow-hidden rounded-xl border border-line bg-raised">
      <video
        src={url}
        controls
        playsInline
        preload="metadata"
        className="mx-auto max-h-[70vh] w-full bg-black object-contain"
      />
      <figcaption className="flex items-center justify-between px-3 py-2 text-[11px] text-muted">
        <span className="tabular-nums">
          {width > 0 ? `${width} x ${height}` : 'Reel'} · no voiceover or captions yet
        </span>
        <a href={url} target="_blank" rel="noreferrer" className="hover:text-ink">
          Open
        </a>
      </figcaption>
    </figure>
  );
}

export interface Rendition {
  id: string;
  url: string;
  spec: TextLayerSpec;
}

/**
 * A generated picture, with the text layer over it when one has been saved (S-12). The picture
 * underneath never changes: the layer is a rendition beside it, so it can be redone or dropped.
 */
export function ImageOutput({
  workspaceId,
  outputId,
  url,
  width,
  height,
  brandColours,
  rendition,
}: {
  workspaceId: string;
  outputId: string;
  url: string;
  width: number;
  height: number;
  brandColours: string[];
  rendition: Rendition | null;
}) {
  const [layer, setLayer] = useState(rendition);
  const [editing, setEditing] = useState(false);
  const shown = layer?.url ?? url;

  return (
    <figure className="overflow-hidden rounded-xl border border-line bg-raised">
      {editing ? (
        <TextLayerEditor
          workspaceId={workspaceId}
          outputId={outputId}
          imageUrl={url}
          width={width}
          height={height}
          brandColours={brandColours}
          initial={layer?.spec ?? null}
          onSaved={(saved) => {
            setLayer(saved);
            setEditing(false);
          }}
          onClose={() => setEditing(false)}
        />
      ) : (
        <a href={shown} target="_blank" rel="noreferrer" className="block">
          {/* A picture from our bucket: next/image would need the host configured, and the
              model already drew it at the size the platform wants. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            // The key makes the browser fetch the new layer rather than the cached one.
            key={shown}
            src={shown}
            alt=""
            className="w-full bg-black object-contain"
          />
        </a>
      )}
      <figcaption className="flex items-center justify-between gap-3 px-3 py-2 text-[11px] text-muted">
        <span className="tabular-nums">{width > 0 ? `${width} x ${height}` : 'Image'}</span>
        <span className="flex items-center gap-3">
          {editing ? null : (
            <button type="button" onClick={() => setEditing(true)} className="hover:text-ink">
              {layer ? 'Edit the text' : 'Add text'}
            </button>
          )}
          <a href={shown} target="_blank" rel="noreferrer" className="hover:text-ink">
            Open
          </a>
        </span>
      </figcaption>
    </figure>
  );
}

/**
 * One platform's caption (S-11). Editable in place so the indicators are live: a caption that
 * is too long can be trimmed here and watched come back under the limit. The edit is local to
 * this screen, not stored: what is kept is the output the generator made, and the way out is
 * Copy or the Composer.
 */
function CaptionCard({
  platform,
  label,
  initial,
  locked,
  accept,
}: {
  platform: TargetPlatform | null;
  label: string;
  initial: string;
  locked: boolean;
  accept?: Accept;
}) {
  const [text, setText] = useState(initial);
  return (
    <div className="rounded-xl border border-line bg-raised px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
        <div className="flex shrink-0 items-center gap-2">
          {text === initial ? null : (
            <button
              type="button"
              onClick={() => setText(initial)}
              className="rounded-lg border border-line px-2.5 py-1 text-xs text-muted transition hover:text-ink"
            >
              Reset
            </button>
          )}
          <CopyButton text={text} locked={locked} accept={accept} />
        </div>
      </div>
      <textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        rows={Math.min(12, Math.max(3, Math.ceil(text.length / 60)))}
        aria-label={`${label} caption`}
        className={cx(
          'mt-2 w-full resize-y rounded-lg border border-transparent bg-transparent text-[15px] leading-7 text-ink outline-none transition focus:border-line focus:bg-surface focus:px-3 focus:py-2',
          locked && 'opacity-80',
        )}
      />
      {platform ? <CaptionMeter platform={platform} text={text} /> : null}
    </div>
  );
}

/**
 * How long a script takes to say (S-10), at the rate the compiler budgets words by. Against
 * the length that was asked for, when one was, so a script that overruns is visible before it
 * is ever recorded.
 */
function ScriptMeter({ text, targetSeconds }: { text: string; targetSeconds?: number | null }) {
  const spoken = words(text);
  const seconds = Math.round(spoken / WORDS_PER_SECOND);
  // A tenth either way of the requested length still reads as the length asked for.
  const over = targetSeconds ? seconds > targetSeconds * 1.1 : false;
  const under = targetSeconds ? seconds < targetSeconds * 0.9 : false;
  return (
    <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted">
      <span className="tabular-nums">
        {spoken.toLocaleString('en-IN')} words, about {seconds}s spoken
      </span>
      {targetSeconds ? (
        <span className={cx('tabular-nums', over || under ? 'text-accent' : 'text-muted')}>
          {over ? 'longer than' : under ? 'shorter than' : 'as asked:'} {targetSeconds}s
        </span>
      ) : null}
    </p>
  );
}

function parse(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

const NAMES: Record<string, string> = { instagram: 'Instagram', linkedin: 'LinkedIn' };

export function OutputView({
  kind,
  text,
  locked,
  targetSeconds,
  workspaceId,
  outputId,
}: {
  kind: string;
  text: string;
  locked: boolean;
  /** The length the script was asked for, when one was chosen. */
  targetSeconds?: number | null;
  /** Present once the output is stored, which is when accepting it can be recorded. */
  workspaceId?: string;
  outputId?: string;
}) {
  const data = parse(text);
  // One piece of a set, measured against the piece the engine wrote rather than the whole.
  const acceptOf = (generated: string): Accept | undefined =>
    workspaceId && outputId ? { workspaceId, outputId, generated } : undefined;

  const list = (value: unknown) =>
    Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
  const { hooks, titles } = (data ?? {}) as { hooks?: unknown; titles?: unknown };
  // Only when the reply has the expected shape; anything else is shown as written below.
  if (kind === 'hook' && list(hooks).length + list(titles).length > 0) {
    return (
      <div className="flex flex-col gap-3">
        {[
          ['Hooks', list(hooks)],
          ['Titles', list(titles)],
        ].map(([title, items]) =>
          (items as string[]).length > 0 ? (
            <div key={title as string} className="flex flex-col gap-2">
              <p className="text-xs font-medium uppercase tracking-wide text-muted">
                {title as string}
              </p>
              {(items as string[]).map((item, i) => (
                <div
                  key={i}
                  className="flex items-start justify-between gap-3 rounded-xl border border-line bg-raised px-4 py-2.5"
                >
                  <p className="text-[15px] leading-6 text-ink">{item}</p>
                  <div className="flex shrink-0 items-center gap-2">
                    {/* No platform publishes a limit on these, so it is a count, not a verdict. */}
                    <span className="text-[11px] tabular-nums text-faint">{item.length}</span>
                    <CopyButton text={item} locked={locked} accept={acceptOf(item)} />
                  </div>
                </div>
              ))}
            </div>
          ) : null,
        )}
      </div>
    );
  }

  if (kind === 'caption' && data && typeof data === 'object' && 'captions' in data) {
    const captions = (data as { captions?: Record<string, unknown> }).captions ?? {};
    return (
      <div className="flex flex-col gap-3">
        {Object.entries(captions).map(([platform, caption]) =>
          typeof caption === 'string' ? (
            <CaptionCard
              key={platform}
              platform={platform in PLATFORM_TEXT_LIMITS ? (platform as TargetPlatform) : null}
              label={NAMES[platform] ?? platform}
              initial={caption}
              locked={locked}
              accept={acceptOf(caption)}
            />
          ) : null,
        )}
      </div>
    );
  }

  // Scripts, and anything that did not come back in the expected shape: shown as written.
  return (
    <Block
      title={kind === 'script' ? 'Script' : undefined}
      text={text}
      locked={locked}
      accept={acceptOf(text)}
      meter={kind === 'script' ? <ScriptMeter text={text} targetSeconds={targetSeconds} /> : null}
    />
  );
}
