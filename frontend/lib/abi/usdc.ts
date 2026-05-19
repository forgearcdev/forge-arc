/**
 * Minimal USDC ABI — slice grows entry-by-entry as phases add real call
 * sites. As of Phase 5g:
 *   - `balanceOf(address) → uint256`         (Phase 5a — Settings card)
 *   - `approve(spender, amount) → bool`       (Phase 5g — Post Job step 1)
 *   - `allowance(owner, spender) → uint256`   (Phase 5g — pre-flight + confirm)
 *
 * Why a hand-rolled subset instead of the full ERC-20 ABI: we only call
 * the surface we actually use, which keeps wagmi's type narrowing tight
 * and the bundle small. Add `transfer`/`Transfer`/`permit` only when a
 * caller needs them.
 *
 * Why we read this directly and DO NOT use wagmi's `useBalance`:
 * Arc's USDC at `0x3600…0000` is a hybrid native+ERC-20 token. The
 * underlying balance is stored in 18-decimal native units; the ERC-20
 * `balanceOf` view divides by 1e12 to expose a standard 6-decimal USDC
 * value. `useBalance` reads the native side (18 decimals), so combining
 * it with our `nativeCurrency.decimals = 6` (which exists only for
 * display formatting elsewhere) produces a value off by 1e12 — i.e.
 * "20 USDC" surfaces as "20,000,000,000,000 USDC."
 *
 * Reading `balanceOf` directly returns the already-scaled 6-decimal
 * value, which is what every other USDC-aware contract on the chain
 * also sees. That's the canonical source of truth.
 *
 * @see memory/reference_arc_addresses.md — "USDC ERC-20 view = native
 *      balance / 1e12" — for the on-chain mechanics, and the
 *      "Frontend pitfall" subsection for this specific lesson.
 */

export const USDC_ABI = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "approve",
    // ERC-20 standard. Returns bool but in practice always true (or
    // reverts on failure). We don't parse the return — instead we
    // refetch `allowance` after the receipt arrives, since chain state
    // is the canonical source-of-truth and the bool is advisory.
    //
    // Arc-specific note: USDC.approve itself doesn't hit the blocklist
    // precompile — only transferFrom does (see
    // reference_arc_addresses.md). So approve will succeed even if the
    // recipient becomes blocklisted later; the blocklist guard fires
    // when JobEscrow.createJob subsequently calls transferFrom to pull
    // the bounty.
    //
    // Phase 5g decision: we approve the EXACT bounty per job, not
    // MaxUint256. This matches contracts/script/SmokeTest.s.sol's
    // approve-then-create pattern and keeps the audit trail crisp
    // (allowance after a job tells you exactly what's still in flight,
    // not "infinity forever").
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "allowance",
    // ERC-20 standard. Used in Phase 5g.3 for two things:
    //   1. Pre-flight — if `allowance >= bounty` already, skip the
    //      approve step in the dialog and go straight to createJob.
    //      Common case after the user has minted/approved before.
    //   2. Post-receipt confirmation — after USDC.approve mines,
    //      refetch and verify `allowance >= bounty` before enabling
    //      the Post Job button. Authoritative because it reads chain
    //      state directly, not the Approval event (which is advisory).
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;
