'use client';

import { Dialog } from '@cgp/ui';
import { artStyle } from '@/lib/art';
import { STUDIO_KINDS } from '@/lib/studio-kinds';

/**
 * "What's on your mind today?" (WP56): the six cards that used to sit at the top of every
 * Studio visit now live here instead, asked once, up front, rather than taking a third of
 * the screen on every return trip. A card on Home still goes straight to its kind via
 * `?kind=`, skipping this entirely — the dialog is only for arriving with no kind decided.
 */
export function KindPickerDialog({
  open,
  art,
  onPick,
}: {
  open: boolean;
  art: string[];
  onPick: (kind: string) => void;
}) {
  return (
    <Dialog
      open={open}
      // Closing without choosing leaves the default (script) in place rather than nothing:
      // Escape is a real way out, not a dead end.
      onClose={() => onPick('script')}
      title="What's on your mind today?"
      description="Pick what you want to make. You can change your mind once you're in."
      className="max-w-2xl"
    >
      <ol className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {STUDIO_KINDS.map((k, i) => (
          <li key={k.key}>
            <button
              type="button"
              onClick={() => onPick(k.key)}
              title={k.hint}
              style={artStyle(i, art)}
              className="group relative flex aspect-[3/4] w-full flex-col justify-end overflow-hidden rounded-2xl border border-line/80 p-3 text-left ring-1 ring-transparent transition-colors duration-base ease-standard hover:border-accent/60 hover:ring-accent/30"
            >
              <span
                aria-hidden
                className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/25 to-transparent"
              />
              <span className="relative flex items-center gap-1.5 text-body font-medium text-white">
                <k.Icon width={16} height={16} aria-hidden />
                {k.label}
              </span>
              <span className="relative text-caption leading-4 text-white/75">{k.hint}</span>
            </button>
          </li>
        ))}
      </ol>
    </Dialog>
  );
}
