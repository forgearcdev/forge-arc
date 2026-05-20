/**
 * Indexer cursor — read/write `lastProcessedBlock` from `indexer_meta`.
 *
 * The cursor is the indexer's only durable state. Everything else
 * (event handler results, payments, agents) is derived from re-scanning
 * the chain. So this module is small but load-bearing — if cursor
 * writes silently fail, the indexer can either re-process the same
 * blocks forever (good — idempotent handlers cope) or skip blocks
 * (bad — events lost).
 *
 * **Failure policy.** Every DB call wraps its error through
 * `classifyDbError` (see `./errors.ts`), which decides whether to
 * throw `IndexerDatabaseError` (fatal — exit) or
 * `TransientConnectionError` (retriable — backoff). Connection
 * resets (Neon auto-pause, DNS hiccups) are NOT fatal.
 *
 * **Initial cursor.** If no row exists in `indexer_meta`, we return
 * `START_BLOCK - 1n` (env-driven, defaults to the JobEscrow deploy
 * block). The first poll then scans from `cursor + 1 = START_BLOCK`
 * forward, which means block-of-deploy is included in the initial
 * scan — useful for catching JobCreated events emitted in the same
 * block as the constructor (none in practice, but harmless).
 */

import { eq } from "drizzle-orm";
import { db, type Tx } from "../db/client.js";
import { indexerMeta } from "../db/schema.js";
import { JOB_ESCROW_DEPLOY_BLOCK } from "../lib/contracts.js";
import { classifyDbError } from "./errors.js";

const CURSOR_KEY = "lastProcessedBlock";

/**
 * The block we should treat as "already processed" before any polling.
 * The next poll will scan from `initialCursor() + 1` onwards.
 *
 * Env-overridable via START_BLOCK (set in `.env`) — useful for testing
 * against a partial range without resetting the DB.
 */
function initialCursor(): bigint {
  const envValue = process.env.START_BLOCK;
  if (envValue) {
    return BigInt(envValue) - 1n;
  }
  return JOB_ESCROW_DEPLOY_BLOCK - 1n;
}

/**
 * Read `lastProcessedBlock` from indexer_meta. Returns the env-defined
 * initial cursor when the row doesn't yet exist (i.e. fresh DB / first run).
 */
export async function getCursor(): Promise<bigint> {
  try {
    const rows = await db
      .select()
      .from(indexerMeta)
      .where(eq(indexerMeta.key, CURSOR_KEY))
      .limit(1);

    const row = rows[0];
    if (!row) {
      return initialCursor();
    }
    return BigInt(row.value);
  } catch (err) {
    throw classifyDbError(err, "Failed to read cursor from indexer_meta");
  }
}

/**
 * UPSERT `lastProcessedBlock = blockNumber` inside a caller-provided
 * Drizzle transaction handle. Stored as text (so we don't lose
 * precision converting between bigint and Postgres int8 mid-roundtrip).
 * The `updatedAt` column is bumped on every write for observability.
 *
 * **Why "InTx" only.** The cursor advance MUST be atomic with the
 * event writes it represents — otherwise a crash between event-commit
 * and cursor-commit causes the next poll to skip those events. Callers
 * (the poller) own the transaction and pass `tx` here.
 */
export async function setCursorInTx(
  tx: Tx,
  blockNumber: bigint,
): Promise<void> {
  try {
    await tx
      .insert(indexerMeta)
      .values({ key: CURSOR_KEY, value: blockNumber.toString() })
      .onConflictDoUpdate({
        target: indexerMeta.key,
        set: { value: blockNumber.toString(), updatedAt: new Date() },
      });
  } catch (err) {
    throw classifyDbError(
      err,
      `Failed to write cursor=${blockNumber.toString()} to indexer_meta`,
    );
  }
}
