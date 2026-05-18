"use client";

/**
 * Aggregates live JobEscrow state into the four metrics shown on the Overview
 * dashboard. One contract for the counter (`nextJobId`), then a batched
 * multi-read for every job's current state (`getJob(1)`, `getJob(2)`, ...).
 *
 * Reads happen against the public Arc testnet RPC through wagmi's default
 * transport. NO wallet connection required — the stats render the same
 * whether or not a user has clicked Connect. Pinning `chainId: CHAIN_ID` on
 * every call guarantees we read from Arc regardless of which chain the
 * connected wallet is currently on.
 *
 * @see frontend_contract_integration_plan.md (memory) for the broader plan
 *      that this hook plugs into.
 */

import { useReadContract, useReadContracts } from "wagmi";
import { useMemo } from "react";
import { CHAIN_ID, CONTRACT_ADDRESSES } from "@/lib/contracts";
import { JOB_ESCROW_ABI } from "@/lib/abi/job-escrow";

/**
 * Mirrors the on-chain enum exactly:
 *   enum JobStatus { None, Funded, Submitted, Completed, Rejected, Expired }
 *
 * Kept as a const-object instead of a TS `enum` so it tree-shakes and so the
 * derived union type (`JobStatus`) is just `0 | 1 | 2 | 3 | 4 | 5` rather
 * than the enum reverse-mapping nonsense.
 */
export const JobStatus = {
  None: 0,
  Funded: 1,
  Submitted: 2,
  Completed: 3,
  Rejected: 4,
  Expired: 5,
} as const;
export type JobStatus = (typeof JobStatus)[keyof typeof JobStatus];

export interface JobStats {
  /** Sum of `bounty` across all Completed jobs, in USDC microunits (6 decimals). */
  totalPaidMicro: bigint;
  /**
   * `completed / (completed + rejected + expired)` as a percentage with one
   * decimal place. `null` when there are zero terminal jobs (would otherwise
   * be 0/0 = NaN) — UI should render an em-dash in that case.
   */
  successRatePercent: number | null;
  /**
   * Count of jobs currently in Funded or Submitted state.
   * Kept as a convenience alias for `funded + submitted` so the overview
   * cards don't have to do the math.
   */
  activeJobs: number;
  /** Count of jobs in Funded status (escrow funded, agent has not yet submitted). */
  funded: number;
  /** Count of jobs in Submitted status (agent submitted, awaiting client review). */
  submitted: number;
  /**
   * Sum of `bounty` for jobs that still have funds locked in escrow —
   * i.e. Funded + Submitted. Completed/Rejected/Expired jobs no longer
   * hold escrow (Completed paid out, Rejected/Expired refunded).
   *
   * In USDC microunits (6 decimals). PipelineOverview's "Total Escrowed"
   * stat reads from here.
   */
  totalEscrowedMicro: bigint;
  /**
   * Count of distinct `agentId` values across ALL jobs we've seen. This is
   * the Forge-scoped "registered agents" metric — only counts agents who've
   * been assigned at least one job in our escrow, not every NFT minted on
   * the global IdentityRegistry. Tradeoff documented in
   * frontend_contract_integration_plan.md.
   */
  uniqueAgents: number;
  /** Total jobs ever created (sum of all status buckets). */
  totalJobs: number;
}

export interface UseJobStatsResult {
  stats: JobStats | null;
  isLoading: boolean;
  isError: boolean;
}

/** Shape of the Job struct returned by JobEscrow.getJob — keep in sync with src/JobEscrow.sol. */
type JobStruct = {
  client: `0x${string}`;
  expiredAt: bigint;
  status: number;
  agentId: bigint;
  bounty: bigint;
  deliverableURI: string;
};

export function useJobStats(): UseJobStatsResult {
  // ── Step 1: discover how many jobs exist ──────────────────────────────
  //
  // `nextJobId` stores the LAST assigned id (counter is pre-incremented
  // inside createJob; see project_status_after_smoketest_v2.md). So the
  // valid jobId range is 1..nextJobId inclusive.
  const {
    data: nextJobIdData,
    isLoading: nextJobIdLoading,
    isError: nextJobIdError,
  } = useReadContract({
    address: CONTRACT_ADDRESSES.jobEscrow,
    abi: JOB_ESCROW_ABI,
    functionName: "nextJobId",
    chainId: CHAIN_ID,
  });

  const nextJobId = nextJobIdData ?? 0n;

  // ── Step 2: build the batched read for every job ─────────────────────
  //
  // wagmi's useReadContracts fires N parallel eth_calls, or a single
  // Multicall3 call if we'd configured `contracts.multicall3` on arcTestnet.
  // We haven't (yet) — at 2 jobs the difference is invisible. Add it later
  // if/when the dashboard regularly reads dozens of jobs.
  const jobIdList = useMemo<bigint[]>(() => {
    const ids: bigint[] = [];
    for (let i = 1n; i <= nextJobId; i++) ids.push(i);
    return ids;
  }, [nextJobId]);

  const {
    data: jobsData,
    isLoading: jobsLoading,
    isError: jobsError,
  } = useReadContracts({
    contracts: jobIdList.map((jobId) => ({
      address: CONTRACT_ADDRESSES.jobEscrow,
      abi: JOB_ESCROW_ABI,
      functionName: "getJob",
      args: [jobId],
      chainId: CHAIN_ID,
    })),
    query: {
      enabled: jobIdList.length > 0,
    },
  });

  // ── Step 3: derive the four stats ────────────────────────────────────
  const stats = useMemo<JobStats | null>(() => {
    // Don't derive anything until we at least know the job count.
    if (nextJobIdLoading) return null;

    // Brand-new contract / zero jobs: return concrete zeros so the UI moves
    // out of its loading state. Without this, jobsData would stay undefined
    // (since the multi-read is disabled), and we'd be stuck "loading" forever.
    if (nextJobId === 0n) {
      return {
        totalPaidMicro: 0n,
        successRatePercent: null,
        activeJobs: 0,
        funded: 0,
        submitted: 0,
        totalEscrowedMicro: 0n,
        uniqueAgents: 0,
        totalJobs: 0,
      };
    }

    if (!jobsData) return null;

    let totalPaidMicro = 0n;
    let totalEscrowedMicro = 0n;
    let completed = 0;
    let rejected = 0;
    let expired = 0;
    let funded = 0;
    let submitted = 0;
    const agentIds = new Set<string>(); // Set<bigint> doesn't dedupe properly across instances — stringify
    let totalJobs = 0;

    for (const entry of jobsData) {
      if (entry.status !== "success" || entry.result == null) continue;
      // wagmi's per-call inference loses some precision in heterogeneous
      // multi-read arrays — cast to the known struct shape. Type is exactly
      // what JobEscrow.getJob returns per src/JobEscrow.sol.
      const job = entry.result as unknown as JobStruct;

      totalJobs++;
      agentIds.add(job.agentId.toString());

      switch (job.status) {
        case JobStatus.Completed:
          totalPaidMicro += job.bounty;
          completed++;
          break;
        case JobStatus.Rejected:
          rejected++;
          break;
        case JobStatus.Expired:
          expired++;
          break;
        case JobStatus.Funded:
          // Bounty is still in escrow until the agent submits + client
          // approves (→ paid) or expiry/refund (→ released back to client).
          totalEscrowedMicro += job.bounty;
          funded++;
          break;
        case JobStatus.Submitted:
          // Submitted = bounty STILL escrowed; client hasn't called
          // complete() or rejected yet.
          totalEscrowedMicro += job.bounty;
          submitted++;
          break;
        // JobStatus.None means an unused jobId slot — shouldn't happen since
        // we iterate 1..nextJobId, but ignoring it is the safe behavior.
      }
    }

    const terminal = completed + rejected + expired;
    // Round to 0.1% precision so we never show "94.21731%". `null` when 0/0.
    const successRatePercent =
      terminal > 0 ? Math.round((completed / terminal) * 1000) / 10 : null;

    return {
      totalPaidMicro,
      successRatePercent,
      activeJobs: funded + submitted,
      funded,
      submitted,
      totalEscrowedMicro,
      uniqueAgents: agentIds.size,
      totalJobs,
    };
  }, [nextJobIdLoading, nextJobId, jobsData]);

  return {
    stats,
    // Only treat the second read as gating loading when we actually have jobs to read.
    isLoading: nextJobIdLoading || (nextJobId > 0n && jobsLoading),
    isError: nextJobIdError || jobsError,
  };
}
