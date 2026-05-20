/**
 * Handler for `PaymentReleased(jobId, provider, amount)`.
 *
 * Inserts a row into `payments`. Separate from `JobCompleted` so the
 * two concerns stay separable: JobCompleted owns the job's STATUS
 * lifecycle; PaymentReleased owns the LEDGER of bounty disbursements.
 * In v1 there's exactly one PaymentReleased per Completed job, but
 * the table shape supports future partial-payment designs without
 * schema churn.
 *
 * **agentId attribution.** PaymentReleased carries `provider`
 * (the NFT owner at time of payment), but our schema also stores
 * `agentId` denormalized on each payment row for fast "lifetime
 * earnings" aggregation. We pull `agentId` from the corresponding
 * `jobs` row (always already inserted in this tx via JobCreated's
 * sibling-lookup pattern, OR pre-existing from an earlier batch).
 *
 * **Idempotency.** The `payments` table uses a `serial id` primary
 * key, so we can't `ON CONFLICT DO NOTHING` on natural keys. Instead
 * we check for an existing row by `(jobId, txHash)` first — a unique
 * combination per the contract semantics (one PaymentReleased per
 * complete tx). If found, do nothing. If not, insert.
 *
 * This costs an extra SELECT per event but keeps the schema simple.
 * Migrating to a unique constraint on (jobId, txHash) is a future
 * optimization once payments accumulate volume.
 */

import { and, eq } from "drizzle-orm";
import { getAddress } from "viem";
import { jobs, payments } from "../../db/schema.js";
import { classifyDbError, IndexerDatabaseError } from "../errors.js";
import type { HandlerArgs } from "../dispatch.js";

export async function handlePaymentReleased({
  tx,
  event,
}: HandlerArgs): Promise<void> {
  const args = event.args as {
    jobId: bigint;
    provider: `0x${string}`;
    amount: bigint;
  };

  try {
    // 1. Look up agentId from the job row (must exist by the time
    //    PaymentReleased fires — JobCreated handler runs first within
    //    the same batch).
    const jobRows = await tx
      .select({ agentId: jobs.agentId })
      .from(jobs)
      .where(eq(jobs.jobId, args.jobId))
      .limit(1);
    const jobRow = jobRows[0];
    if (!jobRow) {
      // Should be unreachable: PaymentReleased without a parent
      // JobCreated would mean a corrupt indexer state.
      throw new Error(
        `PaymentReleased for unknown jobId=${args.jobId.toString()}. ` +
          `JobCreated handler must run first within the same batch.`,
      );
    }

    // 2. Idempotency check: skip if a row already exists for this
    //    (jobId, txHash) pair.
    const existing = await tx
      .select({ id: payments.id })
      .from(payments)
      .where(
        and(
          eq(payments.jobId, args.jobId),
          eq(payments.txHash, event.log.transactionHash),
        ),
      )
      .limit(1);
    if (existing.length > 0) return;

    // 3. Insert.
    await tx.insert(payments).values({
      jobId: args.jobId,
      agentId: jobRow.agentId,
      recipient: getAddress(args.provider).toLowerCase(),
      amountMicro: args.amount,
      blockNumber: event.log.blockNumber,
      txHash: event.log.transactionHash,
      timestamp: event.log.blockTimestamp,
    });
  } catch (err) {
    // The handler's own "unknown jobId" guard (above) throws a plain
    // Error; let it pass through classifyDbError, which will wrap it
    // as IndexerDatabaseError → fatal (correct — corrupt indexer state).
    if (err instanceof IndexerDatabaseError) throw err;
    throw classifyDbError(
      err,
      `INSERT payments (jobId=${args.jobId.toString()}) failed`,
    );
  }
}
