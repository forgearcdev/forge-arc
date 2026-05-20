/**
 * Handler for `JobExpired(jobId)`.
 *
 * Emitted when `claimRefund` transitions a Funded/Submitted job past
 * its deadline to terminal Expired state. The same tx also fires
 * `Refunded` (observed but not persisted in v1, same as Rejected).
 *
 * Idempotent.
 */

import { eq } from "drizzle-orm";
import { jobs } from "../../db/schema.js";
import { classifyDbError } from "../errors.js";
import type { HandlerArgs } from "../dispatch.js";

export async function handleJobExpired({
  tx,
  event,
}: HandlerArgs): Promise<void> {
  const args = event.args as { jobId: bigint };

  try {
    await tx
      .update(jobs)
      .set({
        status: "Expired",
        completedAt: event.log.blockTimestamp,
        completedTxHash: event.log.transactionHash,
      })
      .where(eq(jobs.jobId, args.jobId));
  } catch (err) {
    throw classifyDbError(
      err,
      `UPDATE jobs (status=Expired, jobId=${args.jobId.toString()}) failed`,
    );
  }
}
