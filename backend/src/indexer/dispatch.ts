/**
 * Event dispatcher — Phase 6.3-C.4.
 *
 * Takes a sorted batch of logs from `logs.ts` and routes each to the
 * appropriate handler in `handlers/*`. The whole batch (including
 * cursor advance) runs inside a single `db.transaction()` so a
 * partial-batch failure is atomic — next poll retries from the same
 * cursor and idempotent handlers cope.
 *
 * **Tx-grouping.** Logs are first grouped by `transactionHash`. Each
 * handler receives the full decoded event group from its tx as
 * `txContext`, so handlers can look at siblings (e.g. JobCreated's
 * `agentId` lives in the JobAssignedToAgentId sibling event from the
 * same tx). Events not bound to a handler are silently skipped
 * (e.g. FeedbackSubmitted — observed but out of schema scope).
 *
 * **Decoding.** Address picks the ABI; viem's `decodeEventLog` with
 * `strict: false` returns `{ eventName: undefined }` for logs that
 * don't match any event in the chosen ABI (defensive against an
 * upgraded contract introducing new events the indexer hasn't been
 * updated for).
 */

import { decodeEventLog, type Address, type Hex } from "viem";
import { type Tx } from "../db/client.js";
import { CONTRACT_ADDRESSES } from "../lib/contracts.js";
import { JOB_ESCROW_ABI } from "../lib/abi/job-escrow.js";
import { IDENTITY_REGISTRY_ABI } from "../lib/abi/identity-registry.js";
import type { IndexerLog } from "./logs.js";

import { handleJobCreated } from "./handlers/job-created.js";
import { handleJobSubmitted } from "./handlers/job-submitted.js";
import { handleJobCompleted } from "./handlers/job-completed.js";
import { handleJobRejected } from "./handlers/job-rejected.js";
import { handleJobExpired } from "./handlers/job-expired.js";
import { handlePaymentReleased } from "./handlers/payment-released.js";
import { handleAgentTransfer } from "./handlers/agent-transfer.js";

/* ─── Types shared with handlers ──────────────────────────────────── */

/**
 * A decoded event plus a reference to the IndexerLog it came from.
 * Handlers use the log fields (blockNumber, blockTimestamp, txHash)
 * directly without re-decoding.
 */
export interface DecodedEvent {
  eventName: string;
  args: Record<string, unknown>;
  log: IndexerLog;
}

// `Tx` is the transaction-scoped DB handle (re-exported from db/client).
export { type Tx };

/**
 * Standardized handler signature. Every handler receives:
 *   - the tx-scoped DB instance for writes
 *   - its own decoded event
 *   - the full set of decoded events from the same on-chain tx
 *     (so it can look up sibling events for cross-event data needs)
 */
export interface HandlerArgs {
  tx: Tx;
  event: DecodedEvent;
  txContext: DecodedEvent[];
}

export type Handler = (args: HandlerArgs) => Promise<void>;

const HANDLERS: Readonly<Record<string, Handler>> = {
  JobCreated: handleJobCreated,
  JobSubmitted: handleJobSubmitted,
  JobCompleted: handleJobCompleted,
  JobRejected: handleJobRejected,
  JobExpired: handleJobExpired,
  PaymentReleased: handlePaymentReleased,
  Transfer: handleAgentTransfer,
};

/* ─── ABI selection ───────────────────────────────────────────────── */

function abiForAddress(addr: Address): readonly unknown[] | null {
  const lower = addr.toLowerCase();
  if (lower === CONTRACT_ADDRESSES.jobEscrow.toLowerCase()) {
    return JOB_ESCROW_ABI;
  }
  if (lower === CONTRACT_ADDRESSES.identityRegistry.toLowerCase()) {
    return IDENTITY_REGISTRY_ABI;
  }
  return null;
}

/* ─── Decoding ────────────────────────────────────────────────────── */

function decodeOrNull(log: IndexerLog): DecodedEvent | null {
  const abi = abiForAddress(log.address);
  if (!abi) return null;

  // Cast is needed because we filter the ABI through `unknown[]` for
  // the address selector — viem's `decodeEventLog` wants the literal
  // `Abi` type. Result is also cast: with `abi: any` + `strict: false`
  // viem's return type degrades to `unknown` under our strict
  // tsconfig, so we re-narrow to the shape we know we'll see.
  try {
    const decoded = decodeEventLog({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      abi: abi as any,
      data: log.data,
      topics: log.topics as [Hex, ...Hex[]] | [],
      strict: false,
    }) as { eventName?: string; args?: Record<string, unknown> };

    if (!decoded.eventName) return null;
    return {
      eventName: decoded.eventName,
      args: decoded.args ?? {},
      log,
    };
  } catch {
    // Unrecognized topic signature — skip silently. Could be a new
    // event in a redeployed contract; not our problem to crash.
    return null;
  }
}

/* ─── Batch dispatch ──────────────────────────────────────────────── */

export interface DispatchResult {
  /** Number of handler calls that succeeded. */
  processed: number;
  /** Decoded events with no matching handler (e.g. JobFunded). */
  ignored: number;
  /** Logs we couldn't decode at all (unknown signature). */
  undecoded: number;
}

/**
 * Dispatch a batch of logs USING a caller-provided transaction.
 * Returns counts for the caller (poller) to include in its progress log.
 *
 * Caller is responsible for opening the transaction and writing the
 * cursor advance inside the same `tx` so the whole batch (handler
 * writes + cursor) commits atomically.
 */
export async function dispatchBatchInTx(
  tx: Tx,
  logs: IndexerLog[],
): Promise<DispatchResult> {
  if (logs.length === 0) {
    return { processed: 0, ignored: 0, undecoded: 0 };
  }

  // Group logs by transactionHash, preserving the sorted order
  // within each group (logs are pre-sorted by (block, logIndex) in
  // logs.ts, so within a tx the events come in emission order).
  const byTx = new Map<Hex, IndexerLog[]>();
  for (const log of logs) {
    const list = byTx.get(log.transactionHash);
    if (list) {
      list.push(log);
    } else {
      byTx.set(log.transactionHash, [log]);
    }
  }

  let processed = 0;
  let ignored = 0;
  let undecoded = 0;

  for (const [, txLogs] of byTx) {
    const decoded: DecodedEvent[] = [];
    for (const log of txLogs) {
      const ev = decodeOrNull(log);
      if (ev) {
        decoded.push(ev);
      } else {
        undecoded++;
      }
    }

    // Each handler gets the full decoded set of its tx (txContext)
    // so it can look up siblings (e.g. JobCreated reads JobFunded
    // and JobAssignedToAgentId from this array).
    for (const event of decoded) {
      const handler = HANDLERS[event.eventName];
      if (!handler) {
        ignored++;
        continue;
      }
      await handler({ tx, event, txContext: decoded });
      processed++;
    }
  }

  return { processed, ignored, undecoded };
}
