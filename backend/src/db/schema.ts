/**
 * Drizzle schema for the Forge indexer.
 *
 * Four tables map the canonical onchain state of the Forge marketplace
 * onto Postgres, plus an `indexer_meta` key-value bag for the polling
 * loop's bookkeeping (last processed block, etc.).
 *
 * **bigint vs numeric notes.** Postgres `bigint` is 8 bytes / 64 bits,
 * which is plenty for:
 *   - jobIds (sequential, current chain max ~6)
 *   - agentIds in practice (current chain max 14776; ERC-8004 allows
 *     uint256 globally, but realistic counters stay in 64-bit range)
 *   - bountyMicro (1 USDC = 1e6 micro; bigint covers ~9.2e18 micro ≈
 *     9.2 trillion USDC, well beyond any plausible Forge volume)
 *   - block numbers (current Arc chain head ~4.3e7)
 *   - unix timestamps (good for ~290B years past 1970)
 *
 * If we ever exceed 64-bit range for any of these we migrate to
 * `numeric(78, 0)` — the safe uint256 representation. Not today.
 *
 * **Addresses + hashes stored as lowercase hex text.** Postgres has no
 * native fixed-width binary type that's both indexable and a good
 * match for `0x` hex strings. We normalize to lowercase on insert
 * (see future handlers) so equality joins between event-decoded
 * addresses (viem returns checksummed) and stored values just work.
 */

import {
  bigint,
  index,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

// ─── Enums ───────────────────────────────────────────────────────────

/**
 * Mirror of `JobEscrow.JobStatus` from contracts/src/JobEscrow.sol.
 *
 * The contract's enum starts with `None = 0`, which is NEVER persisted
 * — a job appears in our table only once it transitions to `Funded`
 * (via JobCreated + JobFunded events). We therefore omit `None` from
 * the Postgres enum; storing it would be a bug.
 */
export const jobStatusEnum = pgEnum("job_status", [
  "Funded",
  "Submitted",
  "Completed",
  "Rejected",
  "Expired",
]);
export type JobStatus = (typeof jobStatusEnum.enumValues)[number];

// ─── Tables ──────────────────────────────────────────────────────────

/**
 * One row per job ever created via JobEscrow.createJob.
 *
 * Status transitions over the job's lifecycle; we UPDATE the same row
 * rather than inserting a new one per transition. The four
 * `*_tx_hash` / `*_at` columns let us reconstruct the timeline.
 */
export const jobs = pgTable(
  "jobs",
  {
    jobId: bigint("job_id", { mode: "bigint" }).primaryKey(),
    agentId: bigint("agent_id", { mode: "bigint" }).notNull(),
    /** Client wallet, lowercase 0x-hex (42 chars). */
    client: text("client").notNull(),
    /** Bounty in microUSDC (USDC has 6 decimals). */
    bountyMicro: bigint("bounty_micro", { mode: "bigint" }).notNull(),
    /** Deadline as a unix timestamp in seconds. */
    deadline: bigint("deadline", { mode: "bigint" }).notNull(),
    status: jobStatusEnum("status").notNull(),
    /** Agent's submitted URI; null until JobSubmitted lands. */
    deliverableURI: text("deliverable_uri"),
    /**
     * Lowercase 0x-prefixed 64-char hex (bytes32) on Rejected. Null
     * otherwise. The contract's reason is a free-form bytes32 — we
     * store as-is; the frontend hashes its UI string into bytes32
     * before sending, so this is already-fingerprinted text.
     */
    rejectReason: text("reject_reason"),
    /** Block timestamp (unix seconds) when JobCreated was emitted. */
    createdAt: bigint("created_at", { mode: "bigint" }).notNull(),
    createdBlock: bigint("created_block", { mode: "bigint" }).notNull(),
    createdTxHash: text("created_tx_hash").notNull(),
    /** Set on any terminal transition (Completed / Rejected / Expired). */
    completedAt: bigint("completed_at", { mode: "bigint" }),
    completedTxHash: text("completed_tx_hash"),
  },
  (t) => [
    // Filter by status (e.g. "show me all Funded jobs").
    index("idx_jobs_status").on(t.status),
    // "Jobs for agent #N".
    index("idx_jobs_agent_id").on(t.agentId),
    // "Jobs I (as client) posted".
    index("idx_jobs_client").on(t.client),
    // Chronological feed; ascending index serves DESC scans efficiently
    // (Postgres reads indexes backwards without an extra cost).
    index("idx_jobs_created_at").on(t.createdAt),
  ],
);

/**
 * One row per agent NFT we've ever seen (via IdentityRegistry's
 * ERC-721 Transfer event with `from = 0x0` = mint).
 *
 * `currentOwner` mutates if the NFT is transferred post-mint; the
 * Phase C handler must handle the non-mint Transfer case too.
 */
export const agents = pgTable(
  "agents",
  {
    agentId: bigint("agent_id", { mode: "bigint" }).primaryKey(),
    /** Current ERC-721 owner, lowercase 0x-hex. */
    currentOwner: text("current_owner").notNull(),
    /** Block at which the agent was minted. */
    registeredBlock: bigint("registered_block", { mode: "bigint" }).notNull(),
    /** Block timestamp (unix seconds) at mint. */
    registeredAt: bigint("registered_at", { mode: "bigint" }).notNull(),
  },
  (t) => [
    // "Which agents does wallet X own?"
    index("idx_agents_current_owner").on(t.currentOwner),
  ],
);

/**
 * One row per PaymentReleased event — every time a bounty leaves
 * escrow toward the agent's owner. In v1 there's exactly one
 * PaymentReleased per Completed job, but storing as a separate table
 * (rather than a column on `jobs`) keeps the door open for future
 * partial-payment / streaming-payment designs without schema churn.
 */
export const payments = pgTable(
  "payments",
  {
    id: serial("id").primaryKey(),
    jobId: bigint("job_id", { mode: "bigint" })
      .notNull()
      .references(() => jobs.jobId),
    /** Stored alongside jobId for fast "lifetime earnings" sums. */
    agentId: bigint("agent_id", { mode: "bigint" }).notNull(),
    /** NFT owner at the time of payment (may differ from current). */
    recipient: text("recipient").notNull(),
    amountMicro: bigint("amount_micro", { mode: "bigint" }).notNull(),
    blockNumber: bigint("block_number", { mode: "bigint" }).notNull(),
    txHash: text("tx_hash").notNull(),
    /** Block timestamp (unix seconds). */
    timestamp: bigint("timestamp", { mode: "bigint" }).notNull(),
  },
  (t) => [
    // Lifetime earnings: SUM(amount_micro) GROUP BY agent_id.
    index("idx_payments_agent_id").on(t.agentId),
    // Recent payments feed.
    index("idx_payments_timestamp").on(t.timestamp),
  ],
);

/**
 * Indexer bookkeeping — last processed block, last error timestamp,
 * etc. Generic K/V to avoid schema churn for each new piece of
 * indexer state.
 *
 * Expected keys (defined by Phase C handlers):
 *   - "lastProcessedBlock" → bigint as string, e.g. "43030508"
 */
export const indexerMeta = pgTable("indexer_meta", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
