'use client';

import type { ReactNode } from 'react';
import { useEffect, useRef } from 'react';
import { cx } from './cx';

/**
 * A dialog on the browser's own `<dialog>` element (WP43). That one choice brings the focus
 * trap, the Escape key, the inert background and the top layer with it — all the parts a
 * hand-rolled modal gets wrong, and the reason this product had none at all rather than a bad
 * one.
 *
 * It fills the screen from the bottom on a phone and sits in the middle on a desktop, which
 * is the sheet behaviour the plan listed separately; one component covers both.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    // showModal, not the open attribute: only the modal form gets the top layer and the trap.
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby="dialog-title"
      {...(description ? { 'aria-describedby': 'dialog-description' } : {})}
      // Escape and a click on the backdrop both mean the same thing, and both are the
      // browser's own close, so the state that opened it has to hear about them.
      onClose={onClose}
      onClick={(event) => {
        if (event.target === ref.current) onClose();
      }}
      className={cx(
        'w-full max-w-lg rounded-2xl border border-line bg-surface p-0 text-ink shadow-floating',
        'backdrop:bg-black/60 backdrop:backdrop-blur-sm',
        'max-sm:mb-0 max-sm:max-w-none max-sm:rounded-b-none',
        className,
      )}
    >
      <header className="flex flex-col gap-1 px-6 pt-6">
        <h2 id="dialog-title" className="text-title font-semibold">
          {title}
        </h2>
        {description ? (
          <p id="dialog-description" className="text-body text-muted">
            {description}
          </p>
        ) : null}
      </header>
      <div className="px-6 py-5">{children}</div>
      {footer ? (
        <footer className="flex justify-end gap-2 border-t border-line px-6 py-4">{footer}</footer>
      ) : null}
    </dialog>
  );
}
