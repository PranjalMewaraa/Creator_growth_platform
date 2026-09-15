import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'Creator Growth Platform',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
