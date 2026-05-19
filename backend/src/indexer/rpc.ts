/**
 * Single viem PublicClient for the indexer. All `eth_getLogs`,
 * `eth_blockNumber`, `eth_getBlockByNumber` calls go through here.
 */

import { createPublicClient, http } from "viem";
import { arcTestnet } from "../lib/chain.js";

const rpcUrl = process.env.ARC_RPC_URL ?? "https://rpc.testnet.arc.network";

export const publicClient = createPublicClient({
  chain: arcTestnet,
  transport: http(rpcUrl, {
    // Arc's public RPC has a 10k-block cap on eth_getLogs (error -32614).
    // The Phase C log scanner must chunk; viem itself doesn't auto-chunk.
    // We DO set a generous timeout because chunked scans can issue many
    // sequential calls.
    timeout: 30_000,
    retryCount: 2,
  }),
});
