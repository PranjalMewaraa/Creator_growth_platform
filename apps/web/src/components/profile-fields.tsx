'use client';

import { cx } from '@cgp/ui';
import { useRef, useState, type KeyboardEvent } from 'react';

// Answer controls shared by onboarding and the profile editor: suggestions as chips, with free
// text always allowed, because no list of options fits every creator.

const CHIP =
  'tap-target cursor-pointer rounded-full border px-3.5 py-2 text-sm transition duration-base ease-standard focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40';

/** Answers match suggestions whatever their case: "short video" is the "Short video" chip. */
const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

function chipClass(on: boolean) {
  return cx(
    CHIP,
    on
      ? 'border-accent bg-accent/10 text-ink'
      : 'border-line bg-raised text-muted hover:border-faint hover:text-ink',
  );
}

/** Pick one; a custom answer replaces the suggestion. */
export function ChoiceField({
  options,
  value,
  onChange,
  placeholder,
  label,
}: {
  options: readonly string[];
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  /** What the control is for. A placeholder is not a label: it leaves once typing starts. */
  label: string;
}) {
  const custom = value !== '' && !options.some((o) => same(o, value));
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        {options.map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={same(value, option)}
            onClick={() => onChange(same(value, option) ? '' : option)}
            className={chipClass(same(value, option))}
          >
            {option}
          </button>
        ))}
      </div>
      <input
        value={custom ? value : ''}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={label}
        maxLength={80}
        className="h-11 w-full rounded-xl border border-line bg-raised px-4 text-sm text-ink outline-none transition placeholder:text-faint focus:border-accent/70 focus:ring-2 focus:ring-accent/15"
      />
    </div>
  );
}

/** Pick several; suggestions toggle, and anything typed becomes a tag on Enter or comma. */
export function TagsField({
  options = [],
  value,
  onChange,
  placeholder,
  max,
  label,
}: {
  options?: readonly string[];
  value: string[];
  onChange: (value: string[]) => void;
  placeholder: string;
  max: number;
  /** What the control is for. A placeholder is not a label: it leaves once typing starts. */
  label: string;
}) {
  const [draft, setDraft] = useState('');
  const box = useRef<HTMLInputElement>(null);
  const full = value.length >= max;

  function add(raw: string) {
    const tag = raw.trim().replace(/,$/, '').trim();
    if (!tag || full || value.some((v) => v.toLowerCase() === tag.toLowerCase())) return;
    onChange([...value, tag]);
  }

  const has = (option: string) => value.some((v) => same(v, option));

  function toggle(option: string) {
    if (has(option)) onChange(value.filter((v) => !same(v, option)));
    else if (!full) onChange([...value, option]);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      add(draft);
      setDraft('');
    } else if (event.key === 'Backspace' && draft === '' && value.length > 0) {
      onChange(value.slice(0, -1));
    }
  }

  const custom = value.filter((v) => !options.some((o) => same(o, v)));

  return (
    <div className="flex flex-col gap-3">
      {options.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {options.map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={has(option)}
              onClick={() => toggle(option)}
              disabled={full && !has(option)}
              className={cx(chipClass(has(option)), 'disabled:opacity-40')}
            >
              {option}
            </button>
          ))}
        </div>
      ) : null}
      {/* The box is 44 tall and the field inside it is 32, so the eight pixels either side used
          to be dead to a thumb. Clicking anywhere in the box now puts the caret in the field,
          which is what it already looked like it would do (WP49). */}
      <div
        onClick={() => box.current?.focus()}
        className="flex min-h-11 cursor-text flex-wrap items-center gap-1.5 rounded-xl border border-line bg-raised px-2 py-1.5 transition focus-within:border-accent/70 focus-within:ring-2 focus-within:ring-accent/15"
      >
        {custom.map((tag) => (
          <span
            key={tag}
            className="flex items-center gap-1 rounded-full bg-surface py-1 pl-3 pr-1.5 text-sm text-ink"
          >
            {tag}
            <button
              type="button"
              aria-label={`Remove ${tag}`}
              onClick={() => onChange(value.filter((v) => v !== tag))}
              className="tap-target grid size-5 cursor-pointer place-items-center rounded-full text-muted hover:bg-raised hover:text-ink"
            >
              ×
            </button>
          </span>
        ))}
        <input
          ref={box}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
          onBlur={() => {
            add(draft);
            setDraft('');
          }}
          disabled={full}
          placeholder={full ? `That's the most (${max})` : placeholder}
          aria-label={label}
          maxLength={40}
          className="h-8 min-w-40 flex-1 bg-transparent px-2 text-sm text-ink outline-none placeholder:text-faint disabled:cursor-not-allowed"
        />
      </div>
      <p className="text-xs text-muted">
        {value.length} of {max}. Press Enter to add your own.
      </p>
    </div>
  );
}

export function TextField({
  value,
  onChange,
  placeholder,
  examples = [],
  max,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  examples?: readonly string[];
  max: number;
  /** What the control is for. A placeholder is not a label: it leaves once typing starts. */
  label: string;
}) {
  return (
    <div className="flex flex-col gap-3">
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={label}
        maxLength={max}
        rows={3}
        className="w-full resize-none rounded-xl border border-line bg-raised px-4 py-3 text-[15px] leading-6 text-ink outline-none transition placeholder:text-faint focus:border-accent/70 focus:ring-2 focus:ring-accent/15"
      />
      {examples.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-muted">For example:</span>
          {examples.map((example) => (
            <button
              key={example}
              type="button"
              onClick={() => onChange(example)}
              className="tap-target cursor-pointer rounded-full border border-line px-2.5 py-1 text-xs text-ink transition hover:border-accent/60"
            >
              {example}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** The brief lines the compiler writes from the profile, as the engine will write them. */
export function BriefPreview({
  lines,
  highlight,
}: {
  lines: Array<{ key: string; text: string | null }>;
  highlight?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5 font-mono text-[13px] leading-6">
      {lines.map(({ key, text }) => (
        <p
          key={key}
          className={cx(
            'rounded-md px-2 transition',
            key === highlight ? 'bg-accent/15 text-ink' : 'text-muted',
            !text && 'italic text-faint',
          )}
        >
          {text ?? '…'}
        </p>
      ))}
    </div>
  );
}
