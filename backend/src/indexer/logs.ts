/**
 * Chunked log fetcher — Phase 6.3-C.2.
 *
 * Arc's public RPC enforces a hard 10,000-block ceiling on
 * `eth_getLogs` (error code -32614 when exceeded; see
 * memory/learning_arc_rpc_getlogs_10k_limit.md). We chunk at 5,000
 * blocks for safety headroom — same convention as the frontend's
 * `lib/get-logs-chunked.ts`.
 *
 * For each chunk we fetch logs from BOTH watched contracts in
 * parallel (JobEscrow and IdentityRegistry). Chunks themselves
 * run sequentially — Arc's RPC tolerates ~5 concurrent calls but
 * we don't need the throughput here, and sequential is gentler
 * during cold backfills.
 *
 * `eth_getLogs` does NOT return block timestamps. We need them
 * (for jobs.createdAt, agents.registeredAt, payments.timestamp),
 * so we batch-fetch `getBlock` for every unique block in the
 * result and attach `blockTimestamp` to each log before returning.
 * Handlers never have to make their own RPC calls.
 */

import type { Address, Hex } from "viem";
import { publicClient } from "./rpc.js";
import { CONTRACT_ADDRESSES } from "../lib/contracts.js";

/** Inclusive block-range per `eth_getLogs` call. */
const CHUNK_SIZE = 5000n;

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
 */
export async function getLogsChunked(
  fromBlock: bigint,
  toBlock: bigint,
): Promise<IndexerLog[]> {
  if (fromBlock > toBlock) return [];

  // ── 1. Fetch raw logs in chunks ────────────────────────────────
  type RawLog = Awaited<ReturnType<typeof publicClient.getLogs>>[number];
  const rawLogs: RawLog[] = [];

  let cursor = fromBlock;
  while (cursor <= toBlock) {
    const chunkEndCandidate = cursor + CHUNK_SIZE - 1n;
    const chunkEnd = chunkEndCandidate > toBlock ? toBlock : chunkEndCandidate;

    // Parallel: one getLogs per watched address per chunk.
    const perAddress = await Promise.all(
      WATCHED_ADDRESSES.map((address) =>
        publicClient.getLogs({ address, fromBlock: cursor, toBlock: chunkEnd }),
      ),
    );
    for (const result of perAddress) {
      rawLogs.push(...result);
    }
    cursor = chunkEnd + 1n;
  }

  if (rawLogs.length === 0) return [];

  // ── 2. Batch-fetch block timestamps ────────────────────────────
  const uniqueBlocks = new Map<string, bigint>();
  for (const log of rawLogs) {
    if (log.blockNumber == null) continue;
    uniqueBlocks.set(log.blockNumber.toString(), log.blockNumber);
  }

  const blockTimestamps = new Map<string, bigint>();
  await Promise.all(
    Array.from(uniqueBlocks.values()).map(async (bn) => {
      const block = await publicClient.getBlock({ blockNumber: bn });
      blockTimestamps.set(bn.toString(), block.timestamp);
    }),
  );

  // ── 3. Enrich + sort ───────────────────────────────────────────
  // The non-null assertions here are correct: getLogs against a
  // confirmed range always returns logs with blockNumber, txHash,
  // txIndex, logIndex populated. Only pending/unconfirmed logs
  // have nulls there, and we never query those.
  const enriched: IndexerLog[] = rawLogs
    .map((log): IndexerLog | null => {
      if (
        log.blockNumber == null ||
        log.transactionHash == null ||
        log.transactionIndex == null ||
        log.logIndex == null
      ) {
        return null;
      }
      const ts = blockTimestamps.get(log.blockNumber.toString());
      if (ts == null) return null;
      return {
        blockNumber: log.blockNumber,
        blockTimestamp: ts,
        transactionHash: log.transactionHash,
        transactionIndex: log.transactionIndex,
        logIndex: log.logIndex,
        address: log.address,
        topics: log.topics,
        data: log.data,
      };
    })
    .filter((x): x is IndexerLog => x !== null);

  enriched.sort((a, b) => {
    if (a.blockNumber !== b.blockNumber) {
      return a.blockNumber < b.blockNumber ? -1 : 1;
    }
    return a.logIndex - b.logIndex;
  });

  return enriched;
}
