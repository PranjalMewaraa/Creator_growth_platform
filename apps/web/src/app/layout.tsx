import type { Metadata } from 'next';
import { Inter, JetBrains_Mono, Plus_Jakarta_Sans } from 'next/font/google';
import type { ReactNode } from 'react';
import './globals.css';

// Three jobs, three faces (WP53). Plus Jakarta Sans only ever appears once per screen, on the
// thing the screen is about; Inter carries everything else, body text through nav labels
// through inputs, because the product is read far more than it is looked at; JetBrains Mono
// is for what a column of digits needs — tabular figures that line up, on balances, token
// counts and the "2 of 3" a stage reports. None of this touches BRAND_FONTS (Poppins, Noto
// Sans Devanagari): those are drawn onto a creator's own images server-side from the .ttf
// files in packages/core/fonts, a different mechanism for a different job — what a creator's
// post looks like, not what the product's own chrome looks like.
const display = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['600', '700'],
  variable: '--font-plus-jakarta-sans',
});
const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
});
const mono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-jetbrains-mono',
});

export const metadata: Metadata = {
  // Each page names itself; this is the suffix, so ten open tabs can be told apart (WP51).
  title: { default: 'Creator Growth Platform', template: '%s · Creator Growth Platform' },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${inter.variable} ${mono.variable}`}>
      <body className="min-h-screen font-sans antialiased">{children}</body>
    </html>
  );
}
