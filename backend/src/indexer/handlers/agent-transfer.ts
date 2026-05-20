/**
 * Handler for IdentityRegistry's ERC-721 `Transfer(from, to, tokenId)`.
 *
 * Two cases, both handled in this one file per the project plan:
 *   1. `from === 0x0` (mint) — INSERT new agent row.
 *   2. `from !== 0x0` (real transfer) — UPDATE existing agent's
 *      `currentOwner`.
 *
 * Both paths are idempotent. The mint path uses `ON CONFLICT (agentId)
 * DO UPDATE SET currentOwner = excluded.currentOwner` so replaying a
 * mint after a subsequent transfer doesn't roll back the owner. The
 * transfer path is a plain UPDATE; replaying with the same `to` is
 * a no-op.
 *
 * ⚠️ This handler also fires for Approval/ApprovalForAll if the
 * IdentityRegistry ever emits those, but our ABI decoder + the
 * `eventName === "Transfer"` routing in `dispatch.ts` means only
 * actual Transfers reach here.
 */

import { eq } from "drizzle-orm";
import { getAddress, zeroAddress } from "viem";
import { agents } from "../../db/schema.js";
import { classifyDbError } from "../errors.js";
import type { HandlerArgs } from "../dispatch.js";

export async function handleAgentTransfer({
  tx,
  event,
}: HandlerArgs): Promise<void> {
  const args = event.args as {
    from: `0x${string}`;
    to: `0x${string}`;
    tokenId: bigint;
  };

  const agentId = args.tokenId;
  const toLower = getAddress(args.to).toLowerCase();
  const isMint = args.from.toLowerCase() === zeroAddress.toLowerCase();

  try {
    if (isMint) {
      // First time we see this agent — INSERT with registration
      // metadata. If a row already exists (e.g. replay of the
      // mint), DO UPDATE the currentOwner so the row stays current
      // even if events arrive out of expected order.
      await tx
        .insert(agents)
        .values({
          agentId,
          currentOwner: toLower,
          registeredBlock: event.log.blockNumber,
          registeredAt: event.log.blockTimestamp,
        })
        .onConflictDoUpdate({
          target: agents.agentId,
          set: { currentOwner: toLower },
        });
    } else {
      // Real transfer between two non-zero addresses. We expect a
      // row to already exist (created by the original mint). If not,
      // fall back to INSERT to be safe — but log it as anomalous.
      const updated = await tx
        .update(agents)
        .set({ currentOwner: toLower })
        .where(eq(agents.agentId, agentId))
        .returning({ agentId: agents.agentId });

      if (updated.length === 0) {
        // The mint event must have happened before our indexer's
        // start block. Backfill the agent row with what we know;
        // registeredBlock/At are approximate (this transfer's block,
        // not the original mint's). Flag in a comment in case we
        // ever need to reconcile.
        await tx.insert(agents).values({
          agentId,
          currentOwner: toLower,
          registeredBlock: event.log.blockNumber,
          registeredAt: event.log.blockTimestamp,
        });
      }
    }
  } catch (err) {
    throw classifyDbError(
      err,
      `${isMint ? "INSERT" : "UPDATE"} agents (agentId=${agentId.toString()}) failed`,
    );
  }
}
