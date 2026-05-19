/**
 * Minimal slice of ERC-8004 IdentityRegistry's ABI.
 *
 * The deployed contract is an ERC-1967 upgradeable proxy at
 * `0x8004A818BFB912233c491871b3d84c89A494BD9e`; its implementation lives at
 * `0x7274e874CA62410a93Bd8bf61c69d8045E399c02`. The proxy forwards all calls,
 * so we use the proxy address but reference the implementation's ABI shape.
 *
 * Slice rationale:
 *   - `ownerOf(tokenId)` — resolves agentId → wallet, needed for Recent Jobs
 *     to display "Agent: 0x…" rows in Phase 4e.
 *   - `register(metadataURI)` — mint a new agent NFT to the connected wallet
 *     (Phase 5f Register Agent flow). Returns the new agentId but see the
 *     race warning on the entry itself — read the agentId from the Transfer
 *     log in the receipt, NOT the function return value.
 *   - `Transfer(from, to, tokenId)` — standard ERC-721 mint/transfer event;
 *     used by Phase 5f to extract the minted agentId from a tx receipt.
 *
 * Expand this slice (`tokenURI`, `setApprovalForAll`, etc.) when a later
 * phase actually needs them. Don't preemptively dump the full ABI.
 *
 * Source of truth: Arcscan verified source at
 * `https://testnet.arcscan.app/address/0x7274e874CA62410a93Bd8bf61c69d8045E399c02`,
 * cross-checked against `contracts/script/SmokeTest.s.sol:10-12` and
 * `contracts/test/JobEscrow.fork.t.sol:10-12` — both interfaces declare
 * `register(string) → uint256` and both call it successfully on Arc testnet.
 */

import { parseAbiItem } from "viem";

export const IDENTITY_REGISTRY_ABI = [
  {
    type: "function",
    name: "ownerOf",
    inputs: [{ name: "tokenId", type: "uint256", internalType: "uint256" }],
    outputs: [{ name: "", type: "address", internalType: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "register",
    // Verified against contracts/script/SmokeTest.s.sol (the broadcast that
    // minted agentId 14776) and contracts/test/JobEscrow.fork.t.sol (the
    // fork test that mints fresh agents per case). Both use the identical
    // (string) → uint256 shape, so we KNOW this is the live signature.
    //
    // SECURITY-RELEVANT NOTE: Don't trust wagmi's `result` from the
    // simulation phase. The agentId counter is GLOBAL and races against
    // every other minter on the network — third parties can mint between
    // our simulate→broadcast (we have a memory note about this in
    // `learning_foundry_script_pitfalls.md`). Read the agentId from the
    // Transfer event in the actual receipt, NOT from the function return
    // value.
    inputs: [
      { name: "metadataURI", type: "string", internalType: "string" },
    ],
    outputs: [
      { name: "", type: "uint256", internalType: "uint256" },
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "event",
    name: "Transfer",
    anonymous: false,
    inputs: [
      { name: "from", type: "address", internalType: "address", indexed: true },
      { name: "to", type: "address", internalType: "address", indexed: true },
      { name: "tokenId", type: "uint256", internalType: "uint256", indexed: true },
    ],
  },
] as const;

/**
 * Standalone parsed Transfer event for receipt-log decoding in the
 * Register Agent flow. ERC-721 mints surface as Transfer(0x0, to, tokenId).
 *
 * Re-derived from `parseAbiItem` (rather than indexing the const tuple
 * above) because viem's `parseEventLogs` accepts either form, but the
 * `parseAbiItem` form is what every example in the wagmi docs uses for
 * single-event matching against a receipt — keeps call sites
 * `parseEventLogs({ abi: [IDENTITY_REGISTRY_TRANSFER_EVENT], ... })`
 * concise and unambiguous about which event we're decoding.
 */
export const IDENTITY_REGISTRY_TRANSFER_EVENT = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
);
