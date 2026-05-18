'use client';

/**
 * Client-side context wrappers for wagmi + RainbowKit + React Query.
 *
 * Why a separate 'use client' module: WagmiProvider and RainbowKitProvider
 * both need React context, which means they must be Client Components. The
 * root layout stays a Server Component (which is the default and gives us
 * SSR for everything that doesn't need wagmi). This providers boundary is
 * where the client tree begins.
 *
 * Theme styling: we lean on RainbowKit's `darkTheme` rather than the default
 * light one so the connect modal blends with Forge's dark-navy palette. The
 * accent (#5b9dff) is a hex approximation of the electric-blue oklch we use
 * elsewhere in globals.css.
 */

import { ReactNode, useState } from 'react';
import { WagmiProvider } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RainbowKitProvider, darkTheme } from '@rainbow-me/rainbowkit';
import { wagmiConfig } from '@/lib/wagmi-config';

export function Providers({ children }: { children: ReactNode }) {
  // QueryClient must be stable across renders. useState's lazy initializer
  // runs exactly once on mount; React's reconciler will hand us the same
  // instance on every subsequent render. NOT `const queryClient = new
  // QueryClient()` because that would create a fresh client on each render
  // and discard the cache.
  const [queryClient] = useState(() => new QueryClient());

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider
          theme={darkTheme({
            accentColor: '#5b9dff',
            accentColorForeground: 'white',
            borderRadius: 'medium',
            fontStack: 'rounded',
          })}
        >
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
