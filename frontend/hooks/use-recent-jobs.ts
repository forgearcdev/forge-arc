"use client";

/**
 * Recent Jobs row source — layers per-job creation timestamps on top of the
 * canonical job list that `useJobStats` already maintains.
 *
 * What we need that useJobStats DOESN'T provide:
 *   - When was each job created? (For the "2 hours ago" relative timestamps.)
 *
 * Strategy:
 *   1. Read the jobs array from `useJobStats` (no new RPC for the structs).
 *   2. Scan `JobCreated` events from JobEscrow with `getLogsChunked`.
 *   3. Resolve unique block numbers → block timestamps via parallel
 *      `getBlock` (same pattern as use-payment-history).
 *   4. Merge `jobId → createdAtSeconds` into the normalized job list.
 *   5. Sort by `jobId` DESC (newest first) and slice to `limit` rows.
 *
 * Caching: useQuery's queryKey is keyed on the JobEscrow address +
 * `nextJobId`, so cache busts automatically when a new job is created.
 *
 * @see learning_arc_rpc_getlogs_10k_limit.md (memory) — why we chunk.
 */

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { usePublicClient } from "wagmi";
import { parseAbiItem } from "viem";
import {
  CHAIN_ID,
  CONTRACT_ADDRESSES,
  JOB_ESCROW_DEPLOY_BLOCK,
} from "@/lib/contracts";
import { getLogsChunked } from "@/lib/get-logs-chunked";
import {
  useJobStats,
  type NormalizedJob,
  type JobStatus,
} from "@/hooks/use-job-stats";

/**
 * Lifted from `src/JobEscrow.sol`:
 *   event JobCreated(
 *     uint256 indexed jobId,
 *     address indexed client,
 *     address indexed provider,
 *     address evaluator,
 *     uint256 expiredAt,
 *     address hook
 *   );
 *
 * We only need `jobId` and the block number it was emitted in. `provider`
 * here is the resolved agent-owner ADDRESS at creation time; we still rely
 * on `Job.agentId` from the struct for our agent identity, because the
 * registry could re-mint to a new owner later.
 */
const JOB_CREATED_EVENT = parseAbiItem(
  "event JobCreated(uint256 indexed jobId, address indexed client, address indexed provider, address evaluator, uint256 expiredAt, address hook)",
);

/**
 * Per-jobId metadata pulled from the `JobCreated` log: block timestamp and
 * the transaction hash that created the job. We keep this as its own type
 * (rather than inlining `number | null` everywhere) so the queryFn's
 * intermediate Map stays type-safe.
 */
interface CreationMeta {
  /** Unix seconds when the job was mined. */
  createdAtSeconds: number;
  /** Hash of the createJob transaction — used to deep-link to Arcscan. */
  txHash: `0x${string}`;
}

export interface RecentJob {
  jobId: bigint;
  agentId: bigint;
  client: `0x${string}`;
  expiredAt: bigint;
  bountyMicro: bigint;
  status: JobStatus;
  deliverableURI: string;
  /**
   * Unix seconds when the job was created on-chain. `null` if we couldn't
   * resolve the `JobCreated` log for this jobId (shouldn't happen on a
   * healthy contract, but UI must tolerate it gracefully).
   */
  createdAtSeconds: number | null;
  /**
   * Tx hash of the `createJob` call. `null` when the log lookup failed —
   * same defensive null path as `createdAtSeconds`.
   */
  createdTxHash: `0x${string}` | null;
}

export interface UseRecentJobsResult {
  jobs: RecentJob[] | null;
  isLoading: boolean;
  isError: boolean;
  /** Re-run the underlying timestamp query — used by the table's Retry. */
  refetch: () => void;
}

export interface UseRecentJobsOptions {
  /**
   * Max rows to return after sorting newest-first. Pass `undefined`
   * (or omit) for ALL jobs. The dashboard widget passes `5`; the Jobs
   * section page omits it.
   */
  limit?: number;
}

export function useRecentJobs(
  options: UseRecentJobsOptions = {},
): UseRecentJobsResult {
  const { limit } = options;

  // Pin to CHAIN_ID — same convention as the other hooks.
  const publicClient = usePublicClient({ chainId: CHAIN_ID });

  // Source of truth for job structs + the count we use to invalidate the
  // timestamp cache when a new job lands.
  const {
    stats,
    isLoading: statsLoading,
    isError: statsError,
  } = useJobStats();

  const totalJobs = stats?.totalJobs ?? 0;

  // ── Step 1: fetch a `jobId → createdAtSeconds` map ────────────────────
  //
  // Cached by React Query. Key includes `totalJobs` so the moment a new
  // job lands (useJobStats observes a higher nextJobId), this query
  // invalidates and re-scans for the new event.
  const metaQuery = useQuery<Map<string, CreationMeta>>({
    queryKey: [
      "job-creation-meta",
      CHAIN_ID,
      CONTRACT_ADDRESSES.jobEscrow,
      totalJobs,
    ],
    // Only run once we have a public client AND there's at least one job
    // to find a timestamp for. With zero jobs, the table renders an empty
    // state and never needs this.
    enabled: !!publicClient && totalJobs > 0,
    queryFn: async () => {
      const client = publicClient!;

      const logs = await getLogsChunked({
        publicClient: client,
        address: CONTRACT_ADDRESSES.jobEscrow,
        event: JOB_CREATED_EVENT,
        fromBlock: JOB_ESCROW_DEPLOY_BLOCK,
        toBlock: "latest",
      });

      if (logs.length === 0) return new Map();

      // Dedupe unique block numbers before fetching headers.
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

      // Key the result map by stringified jobId — `Map<bigint, ...>` works
      // for identity checks but bigint keys don't survive serialization
      // (React DevTools, JSON-anything). Stringify for portability.
      const byJobId = new Map<string, CreationMeta>();
      for (const log of logs) {
        const jobId = log.args.jobId;
        const ts = timestampByBlock.get(log.blockNumber!);
        const txHash = log.transactionHash;
        if (jobId == null || ts == null || txHash == null) continue;
        byJobId.set(jobId.toString(), {
          createdAtSeconds: Number(ts),
          txHash,
        });
      }
      return byJobId;
    },
    // Same 30s window as use-payment-history — job creation is rare enough
    // that the cache holds well across navigations.
    staleTime: 30_000,
  });

  // ── Step 2: merge structs with timestamps, sort, slice ────────────────
  //
  // useMemo so we don't reallocate the array on every parent render.
  const recentJobs: RecentJob[] | null = useMemo(() => {
    if (!stats) return null;
    // No jobs yet — surface as an empty array so the UI moves out of the
    // loading state and shows the empty-state CTA.
    if (stats.jobs.length === 0) return [];

    const metaMap = metaQuery.data;
    const merged: RecentJob[] = stats.jobs
      .map((job: NormalizedJob): RecentJob => {
        const meta = metaMap?.get(job.jobId.toString());
        return {
          jobId: job.jobId,
          agentId: job.agentId,
          client: job.client,
          expiredAt: job.expiredAt,
          bountyMicro: job.bountyMicro,
          status: job.status,
          deliverableURI: job.deliverableURI,
          createdAtSeconds: meta?.createdAtSeconds ?? null,
          createdTxHash: meta?.txHash ?? null,
        };
      })
      // bigint comparator: avoid `Number(a - b)` which can overflow for
      // huge ids; return `1 | -1 | 0` explicitly.
      .sort((a, b) => (a.jobId < b.jobId ? 1 : a.jobId > b.jobId ? -1 : 0));

    // `limit == null` means "all jobs" — used by the Jobs section page.
    // The dashboard widget passes an explicit `5`.
    return limit != null ? merged.slice(0, limit) : merged;
  }, [stats, metaQuery.data, limit]);

  return {
    jobs: recentJobs,
    // Loading until both the struct read AND the timestamp scan resolve.
    // When totalJobs is 0 the timestamp query is `enabled: false` and stays
    // `isLoading: false`, so this collapses correctly to "not loading."
    isLoading: statsLoading || (totalJobs > 0 && metaQuery.isLoading),
    isError: statsError || metaQuery.isError,
    refetch: () => {
      void metaQuery.refetch();
    },
  };
}
