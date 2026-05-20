/**
 * Handler for `JobSubmitted(jobId, provider, deliverable)`.
 *
 * **Sibling lookup.** `JobSubmitted` only carries `bytes32 deliverable`
 * (a content hash, not the URI). The plaintext URI is in
 * `DeliverableMetadata(jobId, deliverableURI)` emitted in the same tx.
 * We pull `deliverableURI` from the sibling event.
 *
 * **Idempotency.** This is a state UPDATE — re-applying the same
 * status + URI is a no-op. No special clause needed.
 */

import { eq } from "drizzle-orm";
import { jobs } from "../../db/schema.js";
import { classifyDbError } from "../errors.js";
import type { HandlerArgs } from "../dispatch.js";

export async function handleJobSubmitted({
  tx,
  event,
  txContext,
}: HandlerArgs): Promise<void> {
  const args = event.args as {
    jobId: bigint;
    provider: `0x${string}`;
    deliverable: `0x${string}`;
  };

  // DeliverableMetadata carries the plain-text URI.
  const metaEvent = txContext.find(
    (e) => e.eventName === "DeliverableMetadata",
  );
  const deliverableURI =
    metaEvent && typeof metaEvent.args === "object"
      ? ((metaEvent.args as { deliverableURI?: string }).deliverableURI ?? null)
      : null;

  try {
    await tx
      .update(jobs)
      .set({
        status: "Submitted",
        deliverableURI,
      })
      .where(eq(jobs.jobId, args.jobId));
  } catch (err) {
    throw classifyDbError(
      err,
      `UPDATE jobs (status=Submitted, jobId=${args.jobId.toString()}) failed`,
    );
  }
}
