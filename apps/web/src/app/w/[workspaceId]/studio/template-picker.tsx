'use client';

import { cx } from '@cgp/ui';

// The gallery (WP19, FR-TP), inside the Studio rather than as a destination of its own, since
// picking a template is the first step of making something. Every preview here is real output
// from that template (invariant 14): there is no stock imagery and no written sample, so a
// template with no preview yet says so rather than showing something aspirational.

export interface TemplateCard {
  id: string;
  slug: string;
  title: string;
  description: string;
  outputType: string;
  version: number;
  costBand: string;
  credits: number;
  preview: { mediaUrl: string | null; text: string | null; madeAt: string } | null;
}

const BANDS: Record<string, string> = {
  light: 'Light',
  standard: 'Standard',
  heavy: 'Heavy',
};

/** The first words of a text preview, enough to see the shape of what it writes. */
function snippet(text: string): string {
  const parsed = (() => {
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return null;
    }
  })();
  if (parsed && typeof parsed === 'object') {
    const values = Object.values(parsed as Record<string, unknown>).flatMap((value) =>
      Array.isArray(value)
        ? value.filter((v): v is string => typeof v === 'string')
        : typeof value === 'object' && value !== null
          ? Object.values(value).filter((v): v is string => typeof v === 'string')
          : typeof value === 'string'
            ? [value]
            : [],
    );
    if (values.length > 0) return values.join(' · ');
  }
  return text;
}

export function TemplatePicker({
  templates,
  selected,
  onSelect,
}: {
  templates: TemplateCard[];
  /** Null means the plain template for this output type: no angle of its own. */
  selected: string | null;
  onSelect: (templateId: string | null) => void;
}) {
  if (templates.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs font-medium uppercase tracking-wide text-muted">Template</span>
      <div className="grid gap-2 sm:grid-cols-2">
        {templates.map((template) => {
          const on =
            selected === template.id || (selected === null && template.slug.startsWith('default-'));
          return (
            <button
              key={template.id}
              type="button"
              aria-pressed={on}
              onClick={() => onSelect(template.slug.startsWith('default-') ? null : template.id)}
              className={cx(
                'flex gap-3 rounded-xl border p-2.5 text-left transition',
                on
                  ? 'border-accent bg-accent/5 ring-1 ring-accent/40'
                  : 'border-line bg-raised hover:border-faint',
              )}
            >
              <span className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-canvas text-[10px] leading-tight text-faint">
                {template.preview?.mediaUrl ? (
                  // Real output from this template, made by the preview pipeline.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={template.preview.mediaUrl}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                ) : template.preview?.text ? (
                  <span className="line-clamp-4 p-1">{snippet(template.preview.text)}</span>
                ) : (
                  <span className="p-1 text-center">No preview yet</span>
                )}
              </span>
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="truncate text-sm font-medium text-ink">{template.title}</span>
                <span className="line-clamp-2 text-[11px] leading-4 text-muted">
                  {template.description}
                </span>
                <span className="mt-0.5 text-[11px] text-faint">
                  {BANDS[template.costBand] ?? template.costBand} · {template.credits}{' '}
                  {template.credits === 1 ? 'credit' : 'credits'}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
