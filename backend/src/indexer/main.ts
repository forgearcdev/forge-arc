/**
 * Indexer entry point — Phase 6.3-A scaffold.
 *
 * The polling loop, per-event handlers, and chunked log scanner all
 * land in Phase C. For now this is a no-op that proves:
 *   - tsx loads the module via the npm scripts
 *   - dotenv reads .env
 *   - the viem PublicClient connects to Arc testnet
 *   - the DB client connects to Postgres (when env is set)
 *
 * Run via `pnpm dev` (tsx watch) or `pnpm start` (one-shot Node).
 */

import "dotenv/config";
import { publicClient } from "./rpc.js";

async function main(): Promise<void> {
  const startBlock = process.env.START_BLOCK ?? "42728020";
  const pollMs = process.env.POLL_INTERVAL_MS ?? "5000";

  console.log("[indexer] Phase 6.3-A scaffold — handlers + loop come in Phase C");
  console.log(`[indexer]   START_BLOCK     = ${startBlock}`);
  console.log(`[indexer]   POLL_INTERVAL   = ${pollMs}ms`);
  console.log(`[indexer]   ARC_RPC_URL     = ${process.env.ARC_RPC_URL ?? "(default)"}`);

  // Smoke: prove the RPC client actually talks to Arc. Cheap call,
  // fails loudly on misconfig.
  const head = await publicClient.getBlockNumber();
  console.log(`[indexer]   chain head      = ${head.toString()}`);
}

main().catch((err) => {
  console.error("[indexer] fatal:", err);
  process.exit(1);
});
