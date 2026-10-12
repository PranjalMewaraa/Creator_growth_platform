'use client';

import type { BrandKitInput } from '@cgp/core';
import { Button, cx } from '@cgp/ui';
import { Noto_Sans_Devanagari } from 'next/font/google';
import { useRouter } from 'next/navigation';
import { useRef, useState, type ReactNode } from 'react';
import { saveBrandKitAction } from './brand-kit-actions';

// Poppins is the app font already; the other renderer font is loaded here for its preview.
const devanagari = Noto_Sans_Devanagari({ subsets: ['latin', 'devanagari'], weight: ['600'] });

const FONT_CLASS: Record<BrandKitInput['typography'], string> = {
  Poppins: 'font-sans',
  'Noto Sans Devanagari': devanagari.className,
};

const HEX = /^#[0-9a-f]{6}$/i;
const SUGGESTED = ['#1F2937', '#F59E0B', '#E11D48', '#0EA5E9', '#16A34A', '#7C3AED', '#F5F5F4'];

function Section({ title, hint, children }: { title: string; hint: string; children: ReactNode }) {
  return (
    <div className="grid gap-3 border-t border-line py-5 first:border-t-0 first:pt-0 md:grid-cols-[200px_minmax(0,1fr)] md:gap-6">
      <div>
        <h3 className="text-sm font-medium text-ink">{title}</h3>
        <p className="mt-1 text-xs text-muted">{hint}</p>
      </div>
      <div>{children}</div>
    </div>
  );
}

/** Black or white, whichever reads on the colour. */
function inkOn(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return 0.299 * (r ?? 0) + 0.587 * (g ?? 0) + 0.114 * (b ?? 0) > 150 ? '#111111' : '#FFFFFF';
}

/** S-18: saving a change adds version N+1. */
export function BrandKitEditor({
  workspaceId,
  current,
  version,
  fonts,
}: {
  workspaceId: string;
  current: BrandKitInput;
  version: number;
  fonts: readonly BrandKitInput['typography'][];
}) {
  const router = useRouter();
  const [kit, setKit] = useState(current);
  const [drafts, setDrafts] = useState(current.colors);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: 'good' | 'bad'; text: string } | null>(null);
  const logoInput = useRef<HTMLInputElement>(null);

  const colors = drafts.filter((c) => HEX.test(c)).map((c) => c.toUpperCase());
  const next: BrandKitInput = { ...kit, colors };
  // With no kit yet (version 0) even the starting values are worth saving as version 1.
  const dirty = version === 0 || JSON.stringify(next) !== JSON.stringify(current);
  const invalid = drafts.some((c) => !HEX.test(c)) || colors.length === 0;
  const primary = colors[0] ?? '#1F2937';

  function setColor(i: number, value: string) {
    setDrafts((list) => list.map((c, j) => (j === i ? value : c)));
    setMessage(null);
  }

  async function uploadLogo(file: File | undefined) {
    if (!file) return;
    setUploading(true);
    setMessage(null);
    const form = new FormData();
    form.set('file', file);
    const response = await fetch(`/api/w/${workspaceId}/brand/logo`, { method: 'POST', body: form })
      .then(async (r) => ({ ok: r.ok, body: (await r.json()) as Record<string, unknown> }))
      .catch(() => null);
    setUploading(false);
    if (logoInput.current) logoInput.current.value = '';
    const logoUrl = response?.body.logoUrl;
    if (!response?.ok || typeof logoUrl !== 'string') {
      const error = response?.body.error as
        { issues?: Array<{ message: string }>; code?: string } | undefined;
      return setMessage({
        tone: 'bad',
        text: error?.issues?.[0]?.message ?? 'The logo could not be uploaded.',
      });
    }
    setKit((k) => ({ ...k, logoUrl }));
  }

  async function save() {
    setSaving(true);
    const result = await saveBrandKitAction(workspaceId, next).catch(() => null);
    setSaving(false);
    if (!result) return setMessage({ tone: 'bad', text: 'Could not save. Try again.' });
    if (!result.ok) {
      return setMessage({ tone: 'bad', text: result.issues.map((i) => i.message).join('. ') });
    }
    if (!result.changed) return setMessage({ tone: 'good', text: 'Nothing changed.' });
    router.replace(`/w/${workspaceId}/brand?kit=${result.version}`, { scroll: false });
  }

  return (
    <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="flex flex-col">
        <Section title="Logo" hint="PNG or JPEG, up to 2 MB. Transparent PNG works best.">
          <div className="flex items-center gap-4">
            <div
              className="grid size-20 shrink-0 place-items-center overflow-hidden rounded-xl border border-line"
              style={{
                // A checkerboard shows where the logo is transparent.
                backgroundImage: 'repeating-conic-gradient(#2e2e33 0% 25%, #222226 0% 50%)',
                backgroundSize: '16px 16px',
              }}
            >
              {kit.logoUrl ? (
                // A logo from our bucket: next/image would need the host configured, and a
                // 512px PNG gains nothing from optimisation.
                // eslint-disable-next-line @next/next/no-img-element
                <img src={kit.logoUrl} alt="Logo" className="max-h-16 max-w-16 object-contain" />
              ) : (
                <span className="text-xs text-muted">No logo</span>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <input
                ref={logoInput}
                type="file"
                accept="image/png,image/jpeg"
                className="sr-only"
                id="brand-logo"
                onChange={(event) => void uploadLogo(event.target.files?.[0])}
              />
              <label
                htmlFor="brand-logo"
                className="inline-flex h-10 cursor-pointer items-center rounded-xl border border-line bg-raised px-4 text-sm text-ink transition hover:border-faint"
              >
                {uploading ? 'Uploading…' : kit.logoUrl ? 'Replace' : 'Upload logo'}
              </label>
              {kit.logoUrl ? (
                <Button variant="quiet" onClick={() => setKit((k) => ({ ...k, logoUrl: null }))}>
                  Remove
                </Button>
              ) : null}
            </div>
          </div>
        </Section>

        <Section
          title="Colours"
          hint="Up to three. The first one fills the bars on Instagram copies."
        >
          <div className="flex flex-col gap-3">
            {drafts.map((color, i) => (
              <div key={i} className="flex items-center gap-3">
                <input
                  type="color"
                  value={HEX.test(color) ? color : '#000000'}
                  onChange={(event) => setColor(i, event.target.value.toUpperCase())}
                  aria-label={`Colour ${i + 1}`}
                  className="h-11 w-12 cursor-pointer rounded-lg border border-line bg-raised p-1"
                />
                <input
                  value={color}
                  onChange={(event) => setColor(i, event.target.value.trim())}
                  aria-label={`Colour ${i + 1} as hex`}
                  maxLength={7}
                  className={cx(
                    'h-11 w-32 rounded-lg border bg-raised px-3 font-mono text-sm uppercase text-ink outline-none',
                    HEX.test(color) ? 'border-line focus:border-accent/70' : 'border-bad/60',
                  )}
                />
                <span className="text-xs text-muted">
                  {i === 0 ? 'Primary' : `Colour ${i + 1}`}
                </span>
                {drafts.length > 1 ? (
                  <button
                    type="button"
                    onClick={() => setDrafts((list) => list.filter((_, j) => j !== i))}
                    className="tap-target ml-auto cursor-pointer text-xs text-muted hover:text-bad"
                  >
                    Remove
                  </button>
                ) : null}
              </div>
            ))}
            {drafts.length < 3 ? (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs text-muted">Add:</span>
                {SUGGESTED.filter((c) => !colors.includes(c)).map((c) => (
                  <button
                    key={c}
                    type="button"
                    aria-label={`Add ${c}`}
                    onClick={() => setDrafts((list) => [...list, c])}
                    className="size-7 rounded-full border border-line transition hover:scale-110"
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
            ) : null}
          </div>
        </Section>

        <Section title="Typography" hint="Fonts the renderer has, so text on images matches.">
          <div className="flex flex-wrap gap-2">
            {fonts.map((font) => (
              <button
                key={font}
                type="button"
                aria-pressed={kit.typography === font}
                onClick={() => setKit((k) => ({ ...k, typography: font }))}
                className={cx(
                  'flex flex-col items-start rounded-xl border px-4 py-3 text-left transition',
                  kit.typography === font
                    ? 'border-accent bg-accent/10'
                    : 'border-line bg-raised hover:border-faint',
                )}
              >
                <span className={cx('text-lg font-semibold text-ink', FONT_CLASS[font])}>
                  Aa नमस्ते
                </span>
                <span className="text-xs text-muted">{font}</span>
              </button>
            ))}
          </div>
        </Section>

        <Section title="Tagline" hint="Sets the voice in briefs; it is not pasted into posts.">
          <input
            value={kit.tagline}
            onChange={(event) => setKit((k) => ({ ...k, tagline: event.target.value }))}
            aria-label="Tagline"
            maxLength={80}
            placeholder="e.g. Made in small batches"
            className="h-11 w-full rounded-xl border border-line bg-raised px-4 text-sm text-ink outline-none transition placeholder:text-faint focus:border-accent/70 focus:ring-2 focus:ring-accent/15"
          />
        </Section>
      </div>

      <div className="flex flex-col gap-4 xl:sticky xl:top-20">
        {/* A card in the brand, to judge the kit at a glance. */}
        <div
          className="overflow-hidden rounded-2xl border border-line"
          style={{ backgroundColor: primary, color: inkOn(primary) }}
        >
          <div className="flex items-center gap-3 p-5">
            {kit.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={kit.logoUrl} alt="" className="size-10 rounded-lg object-contain" />
            ) : null}
            <p className={cx('text-xl font-semibold leading-tight', FONT_CLASS[kit.typography])}>
              {kit.tagline || 'Your tagline here'}
            </p>
          </div>
          <div className="flex h-3">
            {colors.map((c) => (
              <span key={c} className="flex-1" style={{ backgroundColor: c }} />
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <Button
            onClick={() => void save()}
            disabled={!dirty || invalid || saving}
            className="w-full"
          >
            {saving ? 'Saving…' : dirty ? `Save as version ${version + 1}` : 'No changes'}
          </Button>
          {dirty ? (
            <Button
              variant="quiet"
              onClick={() => {
                setKit(current);
                setDrafts(current.colors);
              }}
              className="w-full"
            >
              Discard changes
            </Button>
          ) : null}
          {invalid ? (
            <p className="text-sm text-bad">Colours are six digit hex, like #1F2937.</p>
          ) : null}
          {message ? (
            <p className={cx('text-sm', message.tone === 'good' ? 'text-good' : 'text-bad')}>
              {message.text}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
