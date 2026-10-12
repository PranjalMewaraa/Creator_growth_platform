import type { Metadata } from 'next';
import { Poppins } from 'next/font/google';
import type { ReactNode } from 'react';
import './globals.css';

// Poppins is not a variable font, so the weights in use are listed.
const poppins = Poppins({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-poppins',
});

export const metadata: Metadata = {
  // Each page names itself; this is the suffix, so ten open tabs can be told apart (WP51).
  title: { default: 'Creator Growth Platform', template: '%s · Creator Growth Platform' },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={poppins.variable}>
      <body className="min-h-screen font-sans antialiased">{children}</body>
    </html>
  );
}
