/**
 * Arc testnet chain definition — mirror of `frontend/lib/chains.ts`.
 *
 * Kept as a copy (not a cross-workspace import) per the Phase 6.3-A
 * plan: backend is a fully independent workspace; future refactor can
 * consolidate into a shared package if drift becomes painful.
 *
 * See frontend/lib/chains.ts for the deeper explanation of Arc's
 * USDC-as-gas-token model. The indexer doesn't care about wallet
 * decimals (it works directly with microUSDC integers) but viem still
 * wants a chain definition for `createPublicClient`.
 */

import { defineChain } from "viem";

export const arcTestnet = defineChain({
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: {
    name: "USDC",
    symbol: "USDC",
    decimals: 6,
  },
  rpcUrls: {
    default: {
      http: ["https://rpc.testnet.arc.network"],
    },
  },
  blockExplorers: {
    default: {
      name: "Arcscan",
      url: "https://testnet.arcscan.app",
    },
  },
  testnet: true,
});

export const CHAIN_ID = arcTestnet.id;
