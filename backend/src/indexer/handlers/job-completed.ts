/**
 * Handler for `JobCompleted(jobId, evaluator, reason)`.
 *
 * Terminal transition. Sets status, completedAt, completedTxHash.
 * The bounty payout itself is recorded by `payment-released.ts` —
 * JobCompleted owns the JOB STATE; PaymentReleased owns the PAYMENT
 * RECORD. Both fire in the same tx (and same dispatch batch), so the
 * two writes are atomic via the surrounding `db.transaction`.
 *
 * Idempotent — re-applying the same terminal state is a no-op UPDATE.
 */

import { eq } from "drizzle-orm";
import { jobs } from "../../db/schema.js";
import { IndexerDatabaseError } from "../cursor.js";
import type { HandlerArgs } from "../dispatch.js";

export async function handleJobCompleted({
  tx,
  event,
}: HandlerArgs): Promise<void> {
  const args = event.args as {
    jobId: bigint;
    evaluator: `0x${string}`;
    reason: `0x${string}`;
  };

  try {
    await tx
      .update(jobs)
      .set({
        status: "Completed",
        completedAt: event.log.blockTimestamp,
        completedTxHash: event.log.transactionHash,
      })
      .where(eq(jobs.jobId, args.jobId));
  } catch (err) {
    throw new IndexerDatabaseError(
      `UPDATE jobs (status=Completed, jobId=${args.jobId.toString()}) failed`,
      { cause: err },
    );
  }
}
