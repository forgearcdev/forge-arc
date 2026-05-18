/**
 * wagmi configuration for the Forge frontend.
 *
 * Uses RainbowKit's `getDefaultConfig` helper which preconfigures a sensible
 * set of connectors (MetaMask, Coinbase Wallet, Rainbow, WalletConnect, and
 * the injected fallback) and wires them to our chain list. The WalletConnect
 * connector requires a project ID from cloud.reown.com (formerly
 * cloud.walletconnect.com).
 *
 * `ssr: true` is required because we're in the Next.js app router. It tells
 * wagmi not to crash when the config is evaluated server-side during SSR —
 * instead it produces an inert hydration-safe shell that fills in after the
 * client mounts.
 */

import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import { arcTestnet } from './chains';

const projectId = process.env.NEXT_PUBLIC_WC_PROJECT_ID;
if (!projectId) {
  // Fail loudly at module-init time rather than silently producing a broken
  // WalletConnect modal at runtime. .env.local is gitignored; this throw is
  // the signal to set the env var.
  throw new Error(
    'NEXT_PUBLIC_WC_PROJECT_ID is not set. Create frontend/.env.local with a project ID from cloud.reown.com.'
  );
}

export const wagmiConfig = getDefaultConfig({
  appName: 'Forge',
  projectId,
  chains: [arcTestnet],
  ssr: true,
});
