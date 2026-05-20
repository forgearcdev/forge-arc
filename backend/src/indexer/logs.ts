/**
 * Chunked log fetcher — Phase 6.3-D (rate-limited + progress logging).
 *
 * Arc's public RPC enforces a hard 10,000-block ceiling on
 * `eth_getLogs` (error code -32614) and ~100 req/sec overall.
 * We chunk at 9,000 blocks (safety margin under the per-call cap)
 * and gate every RPC call through the module-scoped rate limiter
 * (default 30 req/sec; configurable via `MAX_RPC_REQS_PER_SEC`).
 *
 * Sequential everything during backfill — fewer concurrent calls
 * means cleaner backpressure under the rate limiter, and the
 * 270k-block initial scan completes in a few minutes either way.
 *
 * `eth_getLogs` does NOT return block timestamps. We need them
 * (for jobs.createdAt, agents.registeredAt, payments.timestamp),
 * so we sequentially fetch `getBlock` for every unique block in
 * the result and attach `blockTimestamp` to each log before
 * returning. Handlers never have to make their own RPC calls.
 */

import type { Address, Hex } from "viem";
import { publicClient } from "./rpc.js";
import { CONTRACT_ADDRESSES } from "../lib/contracts.js";
import { rpcRateLimit } from "./rate-limit.js";
import { log } from "./log.js";

/** Inclusive block-range per `eth_getLogs` call. Arc cap is 10k; we leave headroom. */
const CHUNK_SIZE = 9000n;

/** Emit a progress line every Nth chunk during a long backfill. */
const PROGRESS_EVERY_N_CHUNKS = 10;

const WATCHED_ADDRESSES: readonly Address[] = [
  CONTRACT_ADDRESSES.jobEscrow,
  CONTRACT_ADDRESSES.identityRegistry,
];

/**
 * A log enriched with its block's timestamp. All numeric fields are
 * non-null because we filter to confirmed (mined) logs only.
 */
export interface IndexerLog {
  blockNumber: bigint;
  /** Unix seconds; sourced from `eth_getBlockByNumber`. */
  blockTimestamp: bigint;
  transactionHash: Hex;
  transactionIndex: number;
  logIndex: number;
  address: Address;
  topics: readonly Hex[];
  data: Hex;
}

/**
 * Fetch all logs from both watched contracts in the inclusive range
 * [fromBlock, toBlock]. Returns logs sorted by (blockNumber ASC,
 * logIndex ASC) for deterministic processing order.
 *
 * Returns an empty array (no RPC calls made) when fromBlock > toBlock.
 *
 * Every outbound RPC call passes through the rate limiter; under the
 * default 30 req/sec a full chain backfill takes a few minutes but
 * stays well clear of Arc public RPC's 100 req/sec throttle.
 */
export async function getLogsChunked(
  fromBlock: bigint,
  toBlock: bigint,
): Promise<IndexerLog[]> {
  if (fromBlock > toBlock) return [];

  // Estimate chunk count up front so we can log progress proportionally.
  // `+ 1n` because the range is inclusive.
  const totalBlocks = toBlock - fromBlock + 1n;
  const totalChunks = Number((totalBlocks + CHUNK_SIZE - 1n) / CHUNK_SIZE);
  const isBackfill = totalChunks >= PROGRESS_EVERY_N_CHUNKS;

  if (isBackfill) {
    log(
      "info",
      `backfill: ${totalBlocks.toString()} blocks across ${totalChunks} chunks ` +
        `(fromBlock=${fromBlock.toString()}, toBlock=${toBlock.toString()})`,
    );
  }

  // ── 1. Fetch raw logs in chunks ────────────────────────────────
  type RawLog = Awaited<ReturnType<typeof publicClient.getLogs>>[number];
  const rawLogs: RawLog[] = [];

  let cursor = fromBlock;
  let chunkIndex = 0;
  while (cursor <= toBlock) {
    const chunkEndCandidate = cursor + CHUNK_SIZE - 1n;
    const chunkEnd = chunkEndCandidate > toBlock ? toBlock : chunkEndCandidate;

    // Sequential: one address at a time, each call rate-limited.
    // (Parallel Promise.all would also be throttled correctly by
    // the queue-based RateLimiter, but sequential is easier to
    // reason about and matches the user's "no parallelism" ask.)
    for (const address of WATCHED_ADDRESSES) {
      await rpcRateLimit().acquire();
      const result = await publicClient.getLogs({
        address,
        fromBlock: cursor,
        toBlock: chunkEnd,
      });
      rawLogs.push(...result);
    }

    chunkIndex++;
    if (isBackfill && chunkIndex % PROGRESS_EVERY_N_CHUNKS === 0) {
      const percent = Math.floor((chunkIndex / totalChunks) * 100);
      log(
        "info",
        `backfill progress: ${chunkIndex}/${totalChunks} chunks ` +
          `(${percent}%) — at block ${chunkEnd.toString()}, ` +
          `${rawLogs.length} logs collected so far`,
      );
    }

    cursor = chunkEnd + 1n;
  }

  if (rawLogs.length === 0) {
    if (isBackfill) log("info", "backfill complete — 0 logs collected");
    return [];
  }

  // ── 2. Sequentially fetch block timestamps ─────────────────────
  // Could parallelize (rate limiter throttles either way) but
  // sequential keeps memory bounded and produces cleaner logs.
  const uniqueBlocks: bigint[] = [];
  const seenBlocks = new Set<string>();
  for (const lg of rawLogs) {
    if (lg.blockNumber == null) continue;
    const key = lg.blockNumber.toString();
    if (!seenBlocks.has(key)) {
      seenBlocks.add(key);
      uniqueBlocks.push(lg.blockNumber);
    }
  }

  if (isBackfill) {
    log(
      "info",
      `backfill: fetching timestamps for ${uniqueBlocks.length} unique blocks`,
    );
  }

  const blockTimestamps = new Map<string, bigint>();
  for (const bn of uniqueBlocks) {
    await rpcRateLimit().acquire();
    const block = await publicClient.getBlock({ blockNumber: bn });
    blockTimestamps.set(bn.toString(), block.timestamp);
  }

  // ── 3. Enrich + sort ───────────────────────────────────────────
  // The non-null assertions here are correct: getLogs against a
  // confirmed range always returns logs with blockNumber, txHash,
  // txIndex, logIndex populated. Only pending/unconfirmed logs
  // have nulls there, and we never query those.
  const enriched: IndexerLog[] = rawLogs
    .map((lg): IndexerLog | null => {
      if (
        lg.blockNumber == null ||
        lg.transactionHash == null ||
        lg.transactionIndex == null ||
        lg.logIndex == null
      ) {
        return null;
      }
      const ts = blockTimestamps.get(lg.blockNumber.toString());
      if (ts == null) return null;
      return {
        blockNumber: lg.blockNumber,
        blockTimestamp: ts,
        transactionHash: lg.transactionHash,
        transactionIndex: lg.transactionIndex,
        logIndex: lg.logIndex,
        address: lg.address,
        topics: lg.topics,
        data: lg.data,
      };
    })
    .filter((x): x is IndexerLog => x !== null);

  enriched.sort((a, b) => {
    if (a.blockNumber !== b.blockNumber) {
      return a.blockNumber < b.blockNumber ? -1 : 1;
    }
    return a.logIndex - b.logIndex;
  });

  if (isBackfill) {
    log(
      "info",
      `backfill complete — ${enriched.length} logs ready for dispatch`,
    );
  }

  return enriched;
}
