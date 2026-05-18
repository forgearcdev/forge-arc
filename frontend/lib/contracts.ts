/**
 * Single source of truth for deployed-contract addresses on Arc testnet.
 *
 * If we ever ship a mainnet deploy, this is the file to swap (probably via
 * an env var that selects between two address books). For now: testnet-only.
 *
 * @see project_status_after_smoketest_v2.md (memory) — deploy receipt,
 *      gas costs, verification of each address
 */

import { arcTestnet } from "./chains";

/**
 * @dev `as const` is load-bearing here: it preserves literal-string types so
 *      wagmi's `useReadContract({ address: CONTRACT_ADDRESSES.jobEscrow, ... })`
 *      can infer the correct ABI overload. Widening to `Record<string, string>`
 *      would break wagmi's type inference.
 *
 *      The `satisfies` clause cross-checks at compile time that every value
 *      is a 0x-prefixed string — catches typos like a missing `0x` prefix.
 */
export const CONTRACT_ADDRESSES = {
  jobEscrow:          "0x9B02A8BaA84d0B319E5683d9e30838c7D91C414e",
  identityRegistry:   "0x8004A818BFB912233c491871b3d84c89A494BD9e",
  reputationRegistry: "0x8004B663056A597Dffe9eCcC1965A193B7388713",
  // ERC-8004 validation contract — paired with IdentityRegistry and
  // ReputationRegistry per `reference_arc_addresses.md`. Surfaced in the
  // Settings card; not yet read from in any hook.
  validationRegistry: "0x8004Cb1BF31DAf7788923b405b754f57acEB4272",
  usdc:               "0x3600000000000000000000000000000000000000",
} as const satisfies Record<string, `0x${string}`>;

/** The chain we expect to operate on. Used for `useReadContract({ chainId })`. */
export const CHAIN_ID = arcTestnet.id; // 5042002

/**
 * Block at which JobEscrow was deployed. Use as `fromBlock` for any
 * historic `getLogs` calls so we don't scan 42M+ irrelevant blocks.
 *
 * Source: deploy tx `0x1657773c…ad7ad8bd` mined in this block.
 */
export const JOB_ESCROW_DEPLOY_BLOCK = 42_728_020n;
