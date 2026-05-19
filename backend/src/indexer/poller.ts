/**
 * Single polling iteration for the indexer.
 *
 * Workflow per call:
 *   1. Read cursor from indexer_meta.
 *   2. Read chain head via eth_blockNumber.
 *   3. If cursor >= head, return early (caught up).
 *   4. Fetch logs for the inclusive range (cursor+1 → head) via
 *      `getLogsChunked` — respects Arc's 10k-block-per-call ceiling.
 *   5. Open a DB transaction; inside it:
 *        a. dispatch each log to its handler (writes jobs/agents/payments)
 *        b. advance cursor to head
 *      The whole transaction commits atomically — partial-batch failures
 *      roll back BOTH the event writes AND the cursor advance, so the
 *      next poll retries from the same point. Idempotent handlers cope
 *      with the (very unlikely) double-commit race on the same row.
 *
 * Error policy (per project design):
 *   - DB failures throw `IndexerDatabaseError` → main loop exits fatal.
 *   - RPC / decode / network failures throw plain `Error` → main loop
 *     retries with exponential backoff.
 */

import { db } from "../db/client.js";
import { publicClient } from "./rpc.js";
import { getCursor, setCursorInTx } from "./cursor.js";
import { getLogsChunked } from "./logs.js";
import { dispatchBatchInTx } from "./dispatch.js";

export interface PollResult {
  /** Cursor at start of this poll (blocks already processed). */
  fromCursor: bigint;
  /** Cursor at end (== chainHead if any progress was made). */
  toCursor: bigint;
  /** Chain head observed during this poll. */
  chainHead: bigint;
  /** Number of decoded events successfully dispatched to a handler. */
  eventsProcessed: number;
  /** Events whose eventName had no registered handler (e.g. JobFunded). */
  eventsIgnored: number;
  /** Logs whose topic didn't match either ABI (foreign event signatures). */
  logsUndecoded: number;
  /** Wall-clock duration of the iteration in milliseconds. */
  durationMs: number;
}

export async function pollOnce(): Promise<PollResult> {
  const t0 = Date.now();

  // Cursor read — DB. Failure → IndexerDatabaseError → fatal.
  const fromCursor = await getCursor();

  // Chain head — RPC. Failure → retriable.
  const chainHead = await publicClient.getBlockNumber();

  // Caught up? Cheap fast path.
  if (fromCursor >= chainHead) {
    return {
      fromCursor,
      toCursor: fromCursor,
      chainHead,
      eventsProcessed: 0,
      eventsIgnored: 0,
      logsUndecoded: 0,
      durationMs: Date.now() - t0,
    };
  }

  const fromBlock = fromCursor + 1n;
  const toBlock = chainHead;

  // Fetch logs first (RPC-heavy). If this throws, we haven't touched
  // the DB at all — main loop backs off and retries.
  const logs = await getLogsChunked(fromBlock, toBlock);

  // Atomic batch: handler writes + cursor advance in one transaction.
  // Either both commit, or both roll back.
  const dispatchResult = await db.transaction(async (tx) => {
    const result = await dispatchBatchInTx(tx, logs);
    await setCursorInTx(tx, toBlock);
    return result;
  });

  return {
    fromCursor,
    toCursor: toBlock,
    chainHead,
    eventsProcessed: dispatchResult.processed,
    eventsIgnored: dispatchResult.ignored,
    logsUndecoded: dispatchResult.undecoded,
    durationMs: Date.now() - t0,
  };
}
