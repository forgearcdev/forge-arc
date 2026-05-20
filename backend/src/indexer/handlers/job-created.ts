/**
 * Handler for `JobCreated(jobId, client, provider, evaluator, expiredAt, hook)`.
 *
 * **Sibling lookup.** The contract emits THREE events per createJob
 * tx, in order: JobCreated → JobAssignedToAgentId → JobFunded.
 * JobCreated alone doesn't carry `agentId` (it knows only the
 * provider wallet) or `bountyMicro` (the funded amount). We pull
 * both from siblings in the same tx via `txContext`.
 *
 * Idempotent via `ON CONFLICT (jobId) DO NOTHING` — replaying the
 * same JobCreated event is a no-op. (If a future migration ever
 * needs to backfill columns, swap to DO UPDATE with explicit field
 * list.)
 */

import { getAddress } from "viem";
import { jobs } from "../../db/schema.js";
import { classifyDbError } from "../errors.js";
import type { HandlerArgs } from "../dispatch.js";

export async function handleJobCreated({
  tx,
  event,
  txContext,
}: HandlerArgs): Promise<void> {
  const args = event.args as {
    jobId: bigint;
    client: `0x${string}`;
    provider: `0x${string}`;
    evaluator: `0x${string}`;
    expiredAt: bigint;
    hook: `0x${string}`;
  };

  // Siblings in the same tx:
  const fundedEvent = txContext.find((e) => e.eventName === "JobFunded");
  const assignedEvent = txContext.find(
    (e) => e.eventName === "JobAssignedToAgentId",
  );

  if (!fundedEvent || !assignedEvent) {
    // Genuinely surprising — these always fire together onchain.
    // Refuse to insert partial data; let the operator see the
    // miss and decide. The exception propagates out of dispatchBatch's
    // transaction and rolls back the whole batch — next poll retries.
    throw new Error(
      `JobCreated for jobId=${args.jobId.toString()} missing sibling events ` +
        `(funded=${!!fundedEvent}, assigned=${!!assignedEvent}). ` +
        `Tx=${event.log.transactionHash}`,
    );
  }

  const fundedArgs = fundedEvent.args as { amount: bigint };
  const assignedArgs = assignedEvent.args as { agentId: bigint };

  try {
    await tx
      .insert(jobs)
      .values({
        jobId: args.jobId,
        agentId: assignedArgs.agentId,
        client: getAddress(args.client).toLowerCase(),
        bountyMicro: fundedArgs.amount,
        deadline: args.expiredAt,
        status: "Funded",
        deliverableURI: null,
        rejectReason: null,
        createdAt: event.log.blockTimestamp,
        createdBlock: event.log.blockNumber,
        createdTxHash: event.log.transactionHash,
        completedAt: null,
        completedTxHash: null,
      })
      .onConflictDoNothing({ target: jobs.jobId });
  } catch (err) {
    throw classifyDbError(
      err,
      `INSERT jobs (jobId=${args.jobId.toString()}) failed`,
    );
  }
}
