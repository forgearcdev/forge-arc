/**
 * Minimal slice of ERC-8004 ReputationRegistry's ABI.
 *
 * The deployed contract is an ERC-1967 upgradeable proxy at
 * `0x8004B663056A597Dffe9eCcC1965A193B7388713`; implementation at
 * `0x16e0fa7f7c56b9a767e34b192b51f921be31da34` (resolved via EIP-1967
 * implementation-slot read).
 *
 * Slice rationale:
 *   - `getLastIndex(agentId, clientAddress)` — count of feedback entries for
 *     a given (agent, client) pair. Used to derive "how many jobs has agent
 *     X been rated on by client Y."
 *   - `readFeedback(agentId, clientAddress, feedbackIndex)` — pull a single
 *     feedback entry. **1-BASED INDEXING** — passing 0 reverts with
 *     `"index must be > 0"`. See [arc addresses memo](reference_arc_addresses.md)
 *     for the empirical detail.
 *   - `NewFeedback` event — emitted by the registry when feedback is
 *     successfully recorded. 11 params; indexed: `agentId`, `clientAddress`,
 *     `indexedTag1` (hashed). Used by Phase 4f (Top Agents) to aggregate
 *     positive feedback per agent.
 *
 * Source of truth: Arcscan verified source at
 * `https://testnet.arcscan.app/address/0x16e0fa7f7c56b9a767e34b192b51f921be31da34`
 *
 * As elsewhere, the trailing `as const` is required for wagmi v2 type
 * inference on `useReadContract` etc.
 */

export const REPUTATION_REGISTRY_ABI = [
  {
    type: "function",
    name: "getLastIndex",
    inputs: [
      { name: "agentId", type: "uint256", internalType: "uint256" },
      { name: "clientAddress", type: "address", internalType: "address" },
    ],
    outputs: [{ name: "", type: "uint64", internalType: "uint64" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "readFeedback",
    inputs: [
      { name: "agentId", type: "uint256", internalType: "uint256" },
      { name: "clientAddress", type: "address", internalType: "address" },
      { name: "feedbackIndex", type: "uint64", internalType: "uint64" },
    ],
    outputs: [
      { name: "value", type: "int128", internalType: "int128" },
      { name: "valueDecimals", type: "uint8", internalType: "uint8" },
      { name: "tag1", type: "string", internalType: "string" },
      { name: "tag2", type: "string", internalType: "string" },
      { name: "isRevoked", type: "bool", internalType: "bool" },
    ],
    stateMutability: "view",
  },
  {
    type: "event",
    name: "NewFeedback",
    anonymous: false,
    inputs: [
      { name: "agentId", type: "uint256", internalType: "uint256", indexed: true },
      { name: "clientAddress", type: "address", internalType: "address", indexed: true },
      { name: "feedbackIndex", type: "uint64", internalType: "uint64", indexed: false },
      { name: "value", type: "int128", internalType: "int128", indexed: false },
      { name: "valueDecimals", type: "uint8", internalType: "uint8", indexed: false },
      { name: "indexedTag1", type: "string", internalType: "string", indexed: true },
      { name: "tag1", type: "string", internalType: "string", indexed: false },
      { name: "tag2", type: "string", internalType: "string", indexed: false },
      { name: "endpoint", type: "string", internalType: "string", indexed: false },
      { name: "feedbackURI", type: "string", internalType: "string", indexed: false },
      { name: "feedbackHash", type: "bytes32", internalType: "bytes32", indexed: false },
    ],
  },
] as const;
