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
 *   - `Transfer(from, to, tokenId)` — standard ERC-721 mint/transfer event;
 *     included now for future agent-discovery flows even though Phase 4b–e
 *     derives agent counts from JobCreated events instead (per the
 *     [contract integration plan](frontend_contract_integration_plan.md)).
 *
 * Expand this slice (add `register`, `tokenURI`, etc.) when a later phase
 * actually needs them. Don't preemptively dump the full 63-entry ABI.
 *
 * Source of truth: Arcscan verified source at
 * `https://testnet.arcscan.app/address/0x7274e874CA62410a93Bd8bf61c69d8045E399c02`
 */

export const IDENTITY_REGISTRY_ABI = [
  {
    type: "function",
    name: "ownerOf",
    inputs: [{ name: "tokenId", type: "uint256", internalType: "uint256" }],
    outputs: [{ name: "", type: "address", internalType: "address" }],
    stateMutability: "view",
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
