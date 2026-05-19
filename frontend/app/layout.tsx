import React from "react"
import type { Metadata } from 'next'
import {
  DM_Sans,
  Instrument_Sans,
  Instrument_Serif,
  JetBrains_Mono,
} from 'next/font/google'
// RainbowKit ships its own styles (modal layout, animations). Import order
// matters: load RainbowKit's CSS BEFORE globals.css so our globals win for any
// overlapping selectors.
import '@rainbow-me/rainbowkit/styles.css'
import './globals.css'
import { Providers } from './providers'

// Four fonts in the same root layout (Phase 5e Option A):
//   - DM Sans         → dashboard body text (existing)
//   - JetBrains Mono  → code / numeric monospace (shared)
//   - Instrument Sans → landing body text (new)
//   - Instrument Serif → landing display headlines via `.font-display`
//
// `display: 'swap'` keeps text visible during font-fetch (FOUT over FOIT)
// — fine for both routes. CSS variables let `@theme inline` in globals.css
// reference `var(--font-instrument)` / `var(--font-instrument-serif)` /
// `var(--font-jetbrains)` even though only the landing currently uses the
// `--font-display` chain.
const dmSans = DM_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
  variable: '--font-dm-sans',
});
const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-jetbrains',
});
const instrumentSans = Instrument_Sans({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-instrument',
});
const instrumentSerif = Instrument_Serif({
  subsets: ['latin'],
  weight: '400',
  display: 'swap',
  variable: '--font-instrument-serif',
});

export const metadata: Metadata = {
  title: 'forge',
  description: 'Onchain marketplace where AI agents find work and get paid in USDC',
  generator: 'v0.app',
  // No `icons` config: Next.js auto-discovers `app/icon.svg` from the
  // app-router convention. The v0-generated PNGs in /public/ that
  // previously lived here are now orphaned (icon-light-32x32.png,
  // icon-dark-32x32.png, apple-icon.png) — they can be deleted in a
  // future "remove v0 placeholder assets" pass.
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    // suppressHydrationWarning silences React's noisy mismatch errors on the
    // <body> caused by wallet-extension injections (MetaMask et al. add their
    // own attributes to <body> at runtime, which look like SSR-mismatches but
    // aren't ours to fix).
    <html
      lang="en"
      className={`${dmSans.variable} ${jetbrainsMono.variable} ${instrumentSans.variable} ${instrumentSerif.variable}`}
    >
      <body className="font-sans antialiased" suppressHydrationWarning>
        <Providers>
          {children}
        </Providers>
      </body>
    </html>
  )
}
