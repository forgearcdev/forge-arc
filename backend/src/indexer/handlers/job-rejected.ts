/**
 * Handler for `JobRejected(jobId, rejector, reason)`.
 *
 * Terminal transition. Records the bytes32 rejection reason (already
 * frontend-hashed via keccak256(toBytes(text)) per the v1 design
 * decisions). The same tx also fires `Refunded(jobId, client, amount)`,
 * but our schema doesn't have a refunds table — that event is observed
 * but not persisted in v1.
 *
 * Idempotent — re-applying the same terminal state is a no-op.
 */

import { eq } from "drizzle-orm";
import { jobs } from "../../db/schema.js";
import { IndexerDatabaseError } from "../cursor.js";
import type { HandlerArgs } from "../dispatch.js";

export async function handleJobRejected({
  tx,
  event,
}: HandlerArgs): Promise<void> {
  const args = event.args as {
    jobId: bigint;
    rejector: `0x${string}`;
    reason: `0x${string}`;
  };

  try {
    await tx
      .update(jobs)
      .set({
        status: "Rejected",
        rejectReason: args.reason,
        completedAt: event.log.blockTimestamp,
        completedTxHash: event.log.transactionHash,
      })
      .where(eq(jobs.jobId, args.jobId));
  } catch (err) {
    throw new IndexerDatabaseError(
      `UPDATE jobs (status=Rejected, jobId=${args.jobId.toString()}) failed`,
      { cause: err },
    );
  }
}
