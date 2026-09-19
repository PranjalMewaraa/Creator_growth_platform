'use client';

import { cx } from '@cgp/ui';
import { useState, type ReactNode } from 'react';

// A finished output, shaped by what the generator makes: a script reads as paragraphs, hooks
// and titles as lists, captions as one card per platform. Copy stays locked while checking.

function CopyButton({ text, locked }: { text: string; locked: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      disabled={locked}
      title={locked ? 'Available once the check passes' : 'Copy'}
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
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
  children,
}: {
  title?: string;
  text: string;
  locked: boolean;
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
        <CopyButton text={text} locked={locked} />
      </div>
      <div
        className={cx(
          'mt-2 whitespace-pre-wrap text-[15px] leading-7 text-ink',
          locked && 'opacity-80',
        )}
      >
        {children ?? text}
      </div>
    </div>
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
}: {
  kind: string;
  text: string;
  locked: boolean;
}) {
  const data = parse(text);

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
                  <CopyButton text={item} locked={locked} />
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
            <Block
              key={platform}
              title={NAMES[platform] ?? platform}
              text={caption}
              locked={locked}
            />
          ) : null,
        )}
      </div>
    );
  }

  // Scripts, and anything that did not come back in the expected shape: shown as written.
  return <Block title={kind === 'script' ? 'Script' : undefined} text={text} locked={locked} />;
}
