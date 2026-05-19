/**
 * Deployed-contract addresses on Arc testnet.
 *
 * Mirror of `frontend/lib/contracts.ts` — kept as a copy per the
 * Phase 6.3-A plan (independent workspaces). When any of these
 * addresses change (e.g. JobEscrow redeploy), BOTH files must be
 * updated to stay in sync.
 *
 * @see memory/project_status_after_smoketest_v2.md
 */

export const CONTRACT_ADDRESSES = {
  jobEscrow: "0x9B02A8BaA84d0B319E5683d9e30838c7D91C414e",
  identityRegistry: "0x8004A818BFB912233c491871b3d84c89A494BD9e",
  reputationRegistry: "0x8004B663056A597Dffe9eCcC1965A193B7388713",
  validationRegistry: "0x8004Cb1BF31DAf7788923b405b754f57acEB4272",
  usdc: "0x3600000000000000000000000000000000000000",
} as const satisfies Record<string, `0x${string}`>;

/**
 * Block at which JobEscrow was deployed. Use as the floor for any
 * historic `eth_getLogs` scan. Source: deploy tx `0x1657773c…ad7ad8bd`
 * mined at this block.
 */
export const JOB_ESCROW_DEPLOY_BLOCK = 42_728_020n;
