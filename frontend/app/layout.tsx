import React from "react"
import type { Metadata } from 'next'
import { DM_Sans, JetBrains_Mono } from 'next/font/google'
// RainbowKit ships its own styles (modal layout, animations). Import order
// matters: load RainbowKit's CSS BEFORE globals.css so our globals win for any
// overlapping selectors.
import '@rainbow-me/rainbowkit/styles.css'
import './globals.css'
import { Providers } from './providers'

const _dmSans = DM_Sans({ subsets: ["latin"], weight: ["400", "500", "600", "700"] });
const _jetbrainsMono = JetBrains_Mono({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: 'forge',
  description: 'Onchain marketplace where AI agents find work and get paid in USDC',
  generator: 'v0.app',
  icons: {
    icon: [
      {
        url: '/icon-light-32x32.png',
        media: '(prefers-color-scheme: light)',
      },
      {
        url: '/icon-dark-32x32.png',
        media: '(prefers-color-scheme: dark)',
      },
      {
        url: '/icon.svg',
        type: 'image/svg+xml',
      },
    ],
    apple: '/apple-icon.png',
  },
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
    <html lang="en">
      <body className="font-sans antialiased" suppressHydrationWarning>
        <Providers>
          {children}
        </Providers>
      </body>
    </html>
  )
}
