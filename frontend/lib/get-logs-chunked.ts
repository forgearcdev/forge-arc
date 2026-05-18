/**
 * Chunked `eth_getLogs` crawler — works around Arc's public RPC limit.
 *
 * Arc's public RPC at `rpc.testnet.arc.network` rejects any `eth_getLogs`
 * call spanning more than 10,000 blocks with error code -32614 and the
 * message:
 *
 *     "eth_getLogs is limited to a 10,000 range"
 *
 * That's a hard cap enforced by the RPC, not by viem. Since the JobEscrow
 * contract has been live for ~90k blocks (and growing), every full-history
 * scan needs to be split into ≤10k-block windows.
 *
 * This helper:
 *   1. Splits `[fromBlock, toBlock]` into `chunkSize`-block ranges
 *   2. Resolves `toBlock: 'latest'` to a concrete block number ONCE up front,
 *      so the crawl operates on an immutable snapshot (no new blocks slipping
 *      in mid-scan and causing dropped or duplicated events)
 *   3. Runs at most `concurrency` chunks in parallel — politeness toward the
 *      public RPC, and bounded enough that we don't trigger rate limits
 *   4. Flattens results back in chunk order, preserving the chronological
 *      ordering callers expect
 *
 * When this matters:
 *   - usePaymentHistory (PaymentReleased rollup for the USDC Volume chart)
 *   - any future hook reading JobCreated / Submitted / Completed events
 *   - any future hook reading ReputationRegistry NewFeedback events
 *
 * Future optimization (deferred): localStorage cache keyed on
 * (address, event-signature, toBlock) with a short TTL would cut RPC trips
 * on page reload. Not yet worth the complexity — the crawl is ~1.2s for
 * a 92k-block range, and React Query already dedupes within a session.
 *
 * @see memory/learning_arc_rpc_getlogs_10k_limit.md
 */

import type {
  AbiEvent,
  Address,
  GetLogsReturnType,
  PublicClient,
} from "viem";

export interface GetLogsChunkedArgs<TAbiEvent extends AbiEvent> {
  /** Initialized viem public client. Must be defined; gate at the caller. */
  publicClient: PublicClient;
  /** Contract whose logs we're scanning. */
  address: Address;
  /** Single event signature — multi-event scans not supported (yet). */
  event: TAbiEvent;
  /** Inclusive lower bound. Usually the contract's deploy block. */
  fromBlock: bigint;
  /**
   * Inclusive upper bound. Pass `'latest'` to snapshot the current head.
   * Resolved to a concrete `bigint` before any chunks run, so the crawl
   * sees a frozen view of the chain.
   */
  toBlock: bigint | "latest";
  /**
   * Max blocks per request. Defaults to 10_000n to match Arc's public
   * RPC cap. Tune down if a future RPC tightens the limit; tune up only
   * after confirming the target RPC actually allows it.
   */
  chunkSize?: bigint;
  /**
   * Max parallel in-flight requests. 5 is comfortable for the public Arc
   * RPC without being rate-limited; bump cautiously.
   */
  concurrency?: number;
}

export async function getLogsChunked<TAbiEvent extends AbiEvent>(
  args: GetLogsChunkedArgs<TAbiEvent>,
): Promise<GetLogsReturnType<TAbiEvent>> {
  const {
    publicClient,
    address,
    event,
    fromBlock,
    chunkSize = 10_000n,
    concurrency = 5,
  } = args;

  // Resolve "latest" to a concrete block once — protects against the head
  // advancing mid-crawl, which would otherwise risk dropped or duplicate
  // events at the trailing edge.
  const toBlock =
    args.toBlock === "latest"
      ? await publicClient.getBlockNumber()
      : args.toBlock;

  // Defensive: empty / inverted range. Caller mistake, but cheap to handle.
  if (fromBlock > toBlock) {
    return [] as GetLogsReturnType<TAbiEvent>;
  }

  // ── Build chunk ranges ───────────────────────────────────────────────
  // Use closed intervals `[start, end]` because that's how getLogs accepts
  // them. The last chunk gets truncated to `toBlock` so we never overshoot.
  const ranges: Array<readonly [bigint, bigint]> = [];
  for (let start = fromBlock; start <= toBlock; start += chunkSize) {
    const tentativeEnd = start + chunkSize - 1n;
    const end = tentativeEnd < toBlock ? tentativeEnd : toBlock;
    ranges.push([start, end] as const);
  }

  // ── Single-chunk fast path ───────────────────────────────────────────
  // Skip worker-pool overhead and the `results` array dance when there's
  // only one window to fetch.
  if (ranges.length === 1) {
    return publicClient.getLogs({
      address,
      event,
      fromBlock: ranges[0][0],
      toBlock: ranges[0][1],
    }) as Promise<GetLogsReturnType<TAbiEvent>>;
  }

  // ── Bounded-concurrency worker pool ──────────────────────────────────
  // Store results positionally so the final flat array preserves block
  // order regardless of which worker finishes first. A shared `cursor`
  // counter doubles as the work queue.
  const results: GetLogsReturnType<TAbiEvent>[] = new Array(ranges.length);
  let cursor = 0;

  const workerCount = Math.min(concurrency, ranges.length);
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (true) {
        const myIndex = cursor++;
        if (myIndex >= ranges.length) return;
        const [from, to] = ranges[myIndex];
        const logs = (await publicClient.getLogs({
          address,
          event,
          fromBlock: from,
          toBlock: to,
        })) as GetLogsReturnType<TAbiEvent>;
        results[myIndex] = logs;
      }
    }),
  );

  // `Array.prototype.flat` keeps order. Cast back to the inferred return
  // type — TypeScript can't see through the worker indirection.
  return results.flat() as GetLogsReturnType<TAbiEvent>;
}
