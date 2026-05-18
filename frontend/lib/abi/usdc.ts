/**
 * Minimal USDC ABI — just `balanceOf(address) → uint256`.
 *
 * Why a hand-rolled subset instead of the full ERC-20 ABI: we only ever
 * read the balance from this contract (the rest of our flows route
 * through JobEscrow.createJob → JobEscrow handles the actual transfer).
 * Keeping the ABI to one entry minimizes the bundle and makes wagmi's
 * type narrowing instant.
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
] as const;
