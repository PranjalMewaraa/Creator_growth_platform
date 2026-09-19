'use client';

import dynamic from 'next/dynamic';
import type { ComponentProps } from 'react';
import type { WeekCalendar } from './week-calendar';

// Client only: the week, today and each post's status come from the viewer's own clock and
// timezone, which a server render cannot know.
const ClientCalendar = dynamic(() => import('./week-calendar').then((m) => m.WeekCalendar), {
  ssr: false,
  loading: () => (
    <div className="grid gap-5 lg:grid-cols-[300px_minmax(0,1fr)]">
      <div className="h-[720px] animate-pulse rounded-2xl border border-line bg-surface" />
      <div className="h-[720px] animate-pulse rounded-2xl border border-line bg-surface" />
    </div>
  ),
});

export function CalendarLoader(props: ComponentProps<typeof WeekCalendar>) {
  return <ClientCalendar {...props} />;
}
