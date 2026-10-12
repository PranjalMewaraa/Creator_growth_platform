'use client';

import type { ReactNode } from 'react';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { cx } from './cx';

/**
 * Brief confirmation that something happened (WP43). The product had none: an error appeared
 * as red text near the bottom of a form and success was silent, so the only way to know a
 * thing had worked was that nothing said otherwise.
 *
 * A toast is for the outcome of something the person just did. It is never the only place an
 * error appears — anything they need to act on stays on the screen as well.
 */
export interface Toast {
  id: number;
  tone: 'good' | 'bad' | 'neutral';
  message: string;
  /** An action the outcome suggests, such as opening what was just made. */
  action?: { label: string; onClick: () => void };
}

const ToastContext = createContext<((toast: Omit<Toast, 'id'>) => void) | null>(null);

/** How long a toast stays. Long enough to read twice, since it cannot be asked to come back. */
const LINGER_MS = 6000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const show = useCallback((toast: Omit<Toast, 'id'>) => {
    setToasts((current) => [...current, { ...toast, id: Date.now() + Math.random() }]);
  }, []);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div
        // Polite, not assertive: a confirmation should not interrupt what is being read.
        aria-live="polite"
        className="pointer-events-none fixed inset-x-4 bottom-4 z-toast flex flex-col items-center gap-2 sm:left-auto sm:right-6 sm:items-end"
      >
        {toasts.map((toast) => (
          <ToastItem key={toast.id} toast={toast} onDismiss={() => dismiss(toast.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

const TONES = {
  good: 'border-good/40 bg-good/10 text-ink',
  bad: 'border-bad/40 bg-bad/10 text-ink',
  neutral: 'border-line bg-raised text-ink',
} as const;

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, LINGER_MS);
    return () => clearTimeout(timer);
  }, [onDismiss]);

  return (
    <div
      className={cx(
        'pointer-events-auto flex w-full max-w-sm items-center gap-3 rounded-xl border',
        'px-4 py-3 text-body shadow-floating',
        'motion-safe:animate-[toast-in_200ms_cubic-bezier(0.2,0,0,1)]',
        TONES[toast.tone],
      )}
    >
      <span className="flex-1">{toast.message}</span>
      {toast.action ? (
        <button
          type="button"
          onClick={() => {
            toast.action?.onClick();
            onDismiss();
          }}
          className="cursor-pointer text-label font-medium text-accent hover:underline"
        >
          {toast.action.label}
        </button>
      ) : null}
      <button
        type="button"
        aria-label="Dismiss"
        onClick={onDismiss}
        className="cursor-pointer text-muted transition-colors duration-fast hover:text-ink"
      >
        &times;
      </button>
    </div>
  );
}

/** Shows a toast. Returns a no-op outside a provider, so a component is never broken by one. */
export function useToast(): (toast: Omit<Toast, 'id'>) => void {
  const show = useContext(ToastContext);
  return useMemo(() => show ?? (() => undefined), [show]);
}
