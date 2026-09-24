'use client';

import type { TextAlign, TextLayerBlock, TextLayerSpec } from '@cgp/contracts';
import { Button, cx } from '@cgp/ui';
import { useState } from 'react';

// S-12: the text layer over a generated picture. The model never draws words (invariant 12);
// they are vector text composited on the server with the same fonts this preview uses, so what
// is saved is what is seen. Positions and sizes are fractions of the picture, which is why the
// preview can be any size and still match.

const FONTS = ['Poppins', 'Noto Sans Devanagari'] as const;
const ALIGNS: TextAlign[] = ['left', 'center', 'right'];
/** Where a block sits vertically. Dragging can come later; these are the placements used. */
const PLACES = [
  { key: 'top', label: 'Top', y: 0.06 },
  { key: 'middle', label: 'Middle', y: 0.44 },
  { key: 'bottom', label: 'Bottom', y: 0.78 },
] as const;

const WHITE = '#FFFFFF';
const BLACK = '#111111';

function block(text: string, y: number, fontSize: number, colour: string): TextLayerBlock {
  return {
    text,
    x: 0.08,
    y,
    width: 0.84,
    fontSize,
    font: 'Poppins',
    bold: true,
    colour,
    align: 'left',
    plate: null,
  };
}

/** Rough perceived brightness, 0 to 1. */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16) / 255);
  return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
}

/**
 * The colour a headline starts in: the lightest brand colour, since pictures are more often
 * dark behind a headline than light, and white when the kit has nothing light enough.
 */
function startingColour(brandColours: string[]): string {
  const lightest = [...brandColours].sort((a, b) => luminance(b) - luminance(a))[0];
  return lightest && luminance(lightest) > 0.5 ? lightest : WHITE;
}

/** A hex colour at an opacity, for the plate behind the words. */
function rgba(hex: string, opacity: number): string {
  const [r, g, b] = [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16));
  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}

function Swatches({
  colours,
  value,
  onPick,
}: {
  colours: string[];
  value: string;
  onPick: (colour: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {colours.map((colour) => (
        <button
          key={colour}
          type="button"
          aria-label={colour}
          aria-pressed={value.toUpperCase() === colour.toUpperCase()}
          onClick={() => onPick(colour)}
          style={{ background: colour }}
          className={cx(
            'size-6 rounded-full border transition',
            value.toUpperCase() === colour.toUpperCase()
              ? 'border-ink ring-2 ring-accent/50'
              : 'border-line hover:border-faint',
          )}
        />
      ))}
    </div>
  );
}

function Chip({
  on,
  children,
  onClick,
}: {
  on: boolean;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cx(
        'rounded-full border px-3 py-1 text-xs transition',
        on
          ? 'border-accent bg-accent/10 text-ink'
          : 'border-line bg-raised text-muted hover:text-ink',
      )}
    >
      {children}
    </button>
  );
}

export function TextLayerEditor({
  workspaceId,
  outputId,
  imageUrl,
  width,
  height,
  brandColours,
  initial,
  onSaved,
  onClose,
}: {
  workspaceId: string;
  outputId: string;
  /** The picture underneath, always the one the model drew, never a saved layer. */
  imageUrl: string;
  width: number;
  height: number;
  brandColours: string[];
  initial: TextLayerSpec | null;
  onSaved: (rendition: { id: string; url: string; spec: TextLayerSpec }) => void;
  onClose: () => void;
}) {
  const [blocks, setBlocks] = useState<TextLayerBlock[]>(
    initial?.blocks ?? [block('Your headline', 0.06, 0.08, startingColour(brandColours))],
  );
  const [selected, setSelected] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const current = blocks[selected] ?? blocks[0];
  const colours = [...new Set([...brandColours, WHITE, BLACK])];

  function update(patch: Partial<TextLayerBlock>) {
    setBlocks((all) => all.map((b, i) => (i === selected ? { ...b, ...patch } : b)));
  }

  async function save() {
    setSaving(true);
    setError(null);
    const response = await fetch(`/api/w/${workspaceId}/outputs/${outputId}/text-layer`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ spec: { version: 1, blocks } }),
    }).catch(() => null);
    setSaving(false);
    const body = (await response?.json().catch(() => ({}))) as {
      rendition?: { id: string; url: string; spec: TextLayerSpec };
      error?: { issues?: Array<{ message: string }> };
    };
    if (!response?.ok || !body.rendition) {
      setError(
        body.error?.issues?.map((issue) => issue.message).join('. ') ?? 'That did not save.',
      );
      return;
    }
    onSaved(body.rendition);
  }

  if (!current) return null;

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-3">
      {/* The preview. Container query units make every size a fraction of the picture, which
          is exactly how the spec is measured, so this matches what the server draws. */}
      <div
        className="relative w-full overflow-hidden rounded-lg bg-black"
        style={{ aspectRatio: `${width || 4} / ${height || 5}`, containerType: 'size' }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={imageUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
        {blocks.map((b, i) => (
          <button
            key={i}
            type="button"
            onClick={() => setSelected(i)}
            style={{
              position: 'absolute',
              left: `${b.x * 100}%`,
              top: `${b.y * 100}%`,
              width: `${b.width * 100}%`,
              fontSize: `${b.fontSize * 100}cqh`,
              lineHeight: 1.25,
              fontFamily: b.font,
              fontWeight: b.bold ? 700 : 400,
              color: b.colour,
              textAlign: b.align,
              background: b.plate ? rgba(b.plate.colour, b.plate.opacity) : 'transparent',
              padding: b.plate ? '0.4em' : 0,
              borderRadius: b.plate ? '0.3em' : 0,
              margin: b.plate ? '-0.4em 0 0 -0.4em' : 0,
            }}
            className={cx(
              'block whitespace-pre-wrap text-left outline-none',
              i === selected && 'ring-2 ring-accent/70',
            )}
          >
            {b.text}
          </button>
        ))}
      </div>

      {blocks.length > 1 ? (
        <div className="flex gap-1.5">
          {blocks.map((b, i) => (
            <Chip key={i} on={i === selected} onClick={() => setSelected(i)}>
              {i === 0 ? 'Headline' : `Line ${i + 1}`}
            </Chip>
          ))}
        </div>
      ) : null}

      <textarea
        value={current.text}
        onChange={(event) => update({ text: event.target.value })}
        rows={2}
        maxLength={200}
        aria-label="Text"
        className="w-full resize-y rounded-lg border border-line bg-raised px-3 py-2 text-sm text-ink outline-none focus:border-accent/70"
      />

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[11px] text-muted">
        <Swatches
          colours={colours}
          value={current.colour}
          onPick={(colour) => update({ colour })}
        />
        <label className="flex items-center gap-2">
          Size
          <input
            type="range"
            min={2}
            max={20}
            value={Math.round(current.fontSize * 100)}
            onChange={(event) => update({ fontSize: Number(event.target.value) / 100 })}
            className="w-24 accent-[var(--color-accent)]"
          />
        </label>
        <div className="flex gap-1.5">
          {ALIGNS.map((align) => (
            <Chip key={align} on={current.align === align} onClick={() => update({ align })}>
              {align === 'left' ? 'Left' : align === 'center' ? 'Centre' : 'Right'}
            </Chip>
          ))}
        </div>
        <div className="flex gap-1.5">
          {PLACES.map((place) => (
            <Chip
              key={place.key}
              on={Math.abs(current.y - place.y) < 0.02}
              onClick={() => update({ y: place.y })}
            >
              {place.label}
            </Chip>
          ))}
        </div>
        <Chip on={current.bold} onClick={() => update({ bold: !current.bold })}>
          Bold
        </Chip>
        <Chip
          on={current.plate !== null}
          onClick={() => update({ plate: current.plate ? null : { colour: BLACK, opacity: 0.55 } })}
        >
          Plate
        </Chip>
        <div className="flex gap-1.5">
          {FONTS.map((font) => (
            <Chip key={font} on={current.font === font} onClick={() => update({ font })}>
              {font === 'Poppins' ? 'Poppins' : 'Devanagari'}
            </Chip>
          ))}
        </div>
      </div>

      {error ? <p className="text-sm text-bad">{error}</p> : null}

      <div className="flex flex-wrap items-center gap-2">
        {blocks.length < 4 ? (
          <Button
            variant="secondary"
            onClick={() => {
              setBlocks((all) => [
                ...all,
                block('Second line', Math.min(0.9, current.y + 0.12), 0.045, WHITE),
              ]);
              setSelected(blocks.length);
            }}
          >
            Add a line
          </Button>
        ) : null}
        {blocks.length > 1 ? (
          <Button
            variant="secondary"
            onClick={() => {
              setBlocks((all) => all.filter((_, i) => i !== selected));
              setSelected(0);
            }}
          >
            Remove this line
          </Button>
        ) : null}
        <span className="flex-1" />
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
        <Button onClick={() => void save()} disabled={saving}>
          {saving ? 'Drawing…' : 'Save the layer'}
        </Button>
      </div>
    </div>
  );
}
