/**
 * Arc testnet chain definition.
 *
 * Arc is Circle's L1 for stablecoin finance — EVM-compatible, but with USDC as
 * the native gas token instead of ETH. The native USDC ERC-20 view at
 * 0x3600...0000 reports `decimals() = 6`, which is what wagmi/viem hooks like
 * `useBalance` will format against. Setting `decimals: 6` here ensures balance
 * formatting reads as "19.96 USDC" not "19960000.00 USDC".
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
