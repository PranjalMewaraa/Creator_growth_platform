'use client';

import dynamic from 'next/dynamic';
import type { ComponentProps } from 'react';
import type { Composer } from './composer';

// Client only: the draft lives in this browser, so the composer starts from it on first render
// instead of rendering empty on the server and jumping when the draft loads.
const ClientComposer = dynamic(() => import('./composer').then((m) => m.Composer), {
  ssr: false,
  loading: () => (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,42fr)_minmax(0,58fr)]">
      <div className="h-[640px] animate-pulse rounded-2xl border border-line bg-surface" />
      <div className="h-[640px] animate-pulse rounded-2xl border border-line bg-surface" />
    </div>
  ),
});

export function ComposerLoader(props: ComponentProps<typeof Composer>) {
  return <ClientComposer {...props} />;
}
