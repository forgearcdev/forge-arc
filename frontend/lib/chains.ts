/**
 * Arc testnet chain definition.
 *
 * Arc is Circle's L1 for stablecoin finance — EVM-compatible, but with USDC as
 * the native gas token instead of ETH. The native USDC ERC-20 view at
 * 0x3600...0000 reports `decimals() = 6`, so we set `decimals: 6` here for
 * any wagmi/viem helpers that read `chain.nativeCurrency.decimals` purely
 * for FORMATTING purposes (e.g. RainbowKit's "gas estimate" display).
 *
 * ⚠️ Do NOT use `useBalance` for USDC on Arc. `useBalance` returns the
 * underlying NATIVE balance (18 decimals), not the ERC-20 `balanceOf` view
 * (6 decimals). Combining native balance with `decimals: 6` yields a value
 * off by 1e12 — a 20 USDC wallet displays as 20,000,000,000,000 USDC. Read
 * `balanceOf` directly via `useReadContract` against
 * `CONTRACT_ADDRESSES.usdc` and format with `formatUnits(value, 6)`. See
 * `lib/abi/usdc.ts` and `memory/reference_arc_addresses.md` (Frontend
 * pitfall section) for the long-form rationale.
 *
 * @see ../../../contracts/.env.example for the canonical address list
 * @see docs.arc.io/arc/references/connect-to-arc
 */

import { defineChain } from 'viem';

export const arcTestnet = defineChain({
  id: 5042002,
  name: 'Arc Testnet',
  nativeCurrency: {
    // Native gas token IS USDC on Arc — there's no separate ETH-equivalent.
    // The on-chain ERC-20 interface returns decimals() = 6, matching standard
    // USDC. (Arc docs sometimes say "18 decimals" referring to an internal
    // wei-like unit, but the ERC-20 view is the one wagmi uses.)
    name: 'USDC',
    symbol: 'USDC',
    decimals: 6,
  },
  rpcUrls: {
    default: {
      http: ['https://rpc.testnet.arc.network'],
    },
  },
  blockExplorers: {
    default: {
      name: 'Arcscan',
      url: 'https://testnet.arcscan.app',
    },
  },
  testnet: true,
});
