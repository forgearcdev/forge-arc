"use client";

/**
 * Reconstructs the USDC payment timeline by scanning `PaymentReleased` events
 * from the JobEscrow contract. Produces a per-day rollup suitable for feeding
 * straight into recharts.
 *
 * Strategy:
 *   1. `getLogs` against the JobEscrow address, filtered to the
 *      PaymentReleased event, scanning from `JOB_ESCROW_DEPLOY_BLOCK` to
 *      `latest`. Pinning fromBlock to deploy avoids scanning 42M+ irrelevant
 *      blocks on every page load.
 *   2. Logs only carry block NUMBERS, not timestamps — so fetch each unique
 *      block once and build a `blockNumber → timestamp` map. Done in parallel
 *      with `Promise.all` to keep latency at ~1 RTT regardless of event count.
 *   3. Bucket by UTC calendar day (`YYYY-MM-DD`) and sum the `amount` field
 *      in USDC microunits, then convert to whole-USDC numbers for the chart.
 *
 * Caching: wrapped in `useQuery` so React Query handles the loading state,
 * dedupes across components, and gives us automatic background refetching
 * when the user re-focuses the tab. The query key is pinned to CHAIN_ID so
 * a future mainnet swap automatically invalidates the testnet cache.
 *
 * No wallet required — public RPC reads only, same as useJobStats.
 *
 * @see frontend_contract_integration_plan.md (memory) — Phase 4c.
 */

import { useQuery } from "@tanstack/react-query";
import { usePublicClient } from "wagmi";
import { parseAbiItem, type Log } from "viem";
import {
  CHAIN_ID,
  CONTRACT_ADDRESSES,
  JOB_ESCROW_DEPLOY_BLOCK,
} from "@/lib/contracts";

/**
 * Event signature lifted verbatim from `src/JobEscrow.sol`:
 *   event PaymentReleased(uint256 indexed jobId, address indexed provider, uint256 amount);
 *
 * Using `parseAbiItem` (rather than importing the full ABI tuple) keeps this
 * hook focused on a single event and lets viem narrow the `Log` result type
 * so `log.args.amount` is `bigint` instead of `unknown`.
 */
const PAYMENT_RELEASED_EVENT = parseAbiItem(
  "event PaymentReleased(uint256 indexed jobId, address indexed provider, uint256 amount)",
);

export interface DailyVolumePoint {
  /** UTC calendar day in ISO form, e.g. "2026-05-17". Sort key. */
  date: string;
  /** Short human label like "May 17" for the chart x-axis. */
  label: string;
  /** Daily USDC sum as a number (already divided by 1e6). */
  volume: number;
  /** Same total, but exact, in microunits — kept for tooltip precision. */
  volumeMicro: bigint;
}

export interface UsePaymentHistoryResult {
  data: DailyVolumePoint[] | null;
  isLoading: boolean;
  isError: boolean;
}

/**
 * Convert a unix-seconds timestamp (as `bigint` from viem's `block.timestamp`)
 * into an ISO-style `YYYY-MM-DD` string in UTC. UTC — not local time — so that
 * the chart looks identical for users in different timezones. The day a
 * payment "belongs to" is a property of the chain, not of the viewer.
 */
function toUtcDateKey(unixSeconds: bigint): string {
  // `Number(bigint)` is safe here: unix-seconds is well under 2^53 until year ~287396.
  const date = new Date(Number(unixSeconds) * 1000);
  return date.toISOString().slice(0, 10);
}

/**
 * Format a YYYY-MM-DD key into a short "May 17" label for the x-axis. We
 * deliberately avoid the year — the chart's title already establishes the
 * temporal scope, and shorter ticks reduce visual noise.
 */
function toShortLabel(isoDate: string): string {
  // Parse as UTC explicitly (the trailing "T00:00:00Z") so different viewer
  // timezones don't shift the displayed label off by one day.
  const date = new Date(`${isoDate}T00:00:00Z`);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export function usePaymentHistory(): UsePaymentHistoryResult {
  // Pin to CHAIN_ID so we read Arc regardless of which chain the user's
  // wallet is currently on — matches the convention from useJobStats.
  const publicClient = usePublicClient({ chainId: CHAIN_ID });

  const query = useQuery<DailyVolumePoint[]>({
    // `chainId` in the key makes mainnet/testnet caches independent.
    queryKey: ["payment-history", CHAIN_ID, CONTRACT_ADDRESSES.jobEscrow],
    // The query runs only once a public client exists. During the initial SSR
    // pass `publicClient` is undefined, which is exactly when we want to wait.
    enabled: !!publicClient,
    queryFn: async () => {
      // Non-null assertion safe because `enabled` gates execution.
      const client = publicClient!;

      // ── 1. Fetch every PaymentReleased ever emitted ─────────────────
      const logs = await client.getLogs({
        address: CONTRACT_ADDRESSES.jobEscrow,
        event: PAYMENT_RELEASED_EVENT,
        fromBlock: JOB_ESCROW_DEPLOY_BLOCK,
        toBlock: "latest",
      });

      if (logs.length === 0) return [];

      // ── 2. Resolve unique block timestamps in parallel ──────────────
      //
      // Many payments could land in the same block, so dedupe before
      // hitting the RPC. `Set<bigint>` works fine for primitive bigint
      // values (unlike object refs).
      const uniqueBlockNumbers = Array.from(
        new Set(logs.map((log) => log.blockNumber!)),
      );
      const blocks = await Promise.all(
        uniqueBlockNumbers.map((blockNumber) =>
          client.getBlock({ blockNumber }),
        ),
      );
      const timestampByBlock = new Map<bigint, bigint>(
        blocks.map((b) => [b.number, b.timestamp]),
      );

      // ── 3. Bucket events by UTC day, summing amounts in microunits ──
      //
      // Microunits stay bigint until the very end — converting to Number
      // mid-aggregation would lose precision past ~9 trillion microUSDC
      // (~9M USDC). Unlikely today, but cheap to do correctly now.
      const dailyMicro = new Map<string, bigint>();
      for (const log of logs as Log<
        bigint,
        number,
        false,
        typeof PAYMENT_RELEASED_EVENT
      >[]) {
        const timestamp = timestampByBlock.get(log.blockNumber!);
        if (timestamp == null) continue; // shouldn't happen — defensive guard
        const dateKey = toUtcDateKey(timestamp);
        const amount = log.args.amount ?? 0n;
        dailyMicro.set(dateKey, (dailyMicro.get(dateKey) ?? 0n) + amount);
      }

      // ── 4. Emit sorted array of points ──────────────────────────────
      const points: DailyVolumePoint[] = Array.from(dailyMicro.entries())
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([date, volumeMicro]) => ({
          date,
          label: toShortLabel(date),
          // Number conversion: divide AFTER the sum. 1e6 microUSDC = 1 USDC.
          volume: Number(volumeMicro) / 1_000_000,
          volumeMicro,
        }));

      return points;
    },
    // 30s staleness — chart refetches on focus but doesn't hammer the RPC
    // during a single navigation session. Volume changes slowly relative to
    // dashboard polling.
    staleTime: 30_000,
  });

  return {
    data: query.data ?? null,
    isLoading: query.isLoading,
    isError: query.isError,
  };
}
