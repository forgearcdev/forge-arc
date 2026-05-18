"use client";

/**
 * My Activity hook — slices the canonical job list by the connected wallet.
 *
 * Two perspectives, both derived from data that's already in flight elsewhere
 * (zero new RPC calls beyond what `useAgents` + `useRecentJobs` already
 * trigger):
 *
 *   - **As Client** — jobs where `job.client === address`. The user is the
 *     one who funded the bounty and acts as the evaluator at completion.
 *
 *   - **As Agent** — jobs where the connected wallet is the current owner of
 *     `job.agentId` (per IdentityRegistry.ownerOf, already read by useAgents).
 *     The user is on the receiving end of the bounty when the job completes.
 *
 * The same wallet can appear on BOTH sides of the same job — in our smoke
 * test the deployer is the client on Job #2 AND owns agentId 14776 — so the
 * two arrays can overlap. That's fine; each view tells a different story.
 *
 * Returns `null` data when disconnected; the section component should render
 * a "Connect wallet" empty state in that case rather than calling this hook
 * with a placeholder address.
 *
 * Loading is `true` while either the canonical job list (useRecentJobs) or
 * the owner-address map (useAgents) hasn't resolved yet. We need BOTH to
 * filter correctly: jobs alone tell us `client`, but only useAgents tells
 * us `owner(agentId)`.
 */

import { useMemo } from "react";
import { useAccount } from "wagmi";
import { JobStatus } from "@/hooks/use-job-stats";
import { useRecentJobs, type RecentJob } from "@/hooks/use-recent-jobs";
import { useAgents } from "@/hooks/use-agents";

export interface ClientStats {
  /** Jobs the wallet posted, sorted by jobId DESC (newest first). */
  jobs: RecentJob[];
  /** Total jobs ever posted by this wallet (any status). */
  posted: number;
  /**
   * USDC microunits paid out from this wallet across all `Completed` jobs.
   * Refunded jobs (Rejected/Expired) don't count — the money came back.
   */
  spentMicro: bigint;
  /**
   * `completed / (completed + rejected + expired)` × 100, one-decimal precision.
   * `null` when there are zero terminal jobs (formula would be 0/0). UI
   * should render an em-dash in that case.
   */
  successRatePercent: number | null;
}

export interface AgentStats {
  /**
   * Jobs assigned to an agentId this wallet currently owns, sorted by
   * jobId DESC. "Currently owns" matters — if the wallet transferred
   * the NFT after a completion, the prior earnings drop off this view
   * (the new owner sees them).
   */
  jobs: RecentJob[];
  /** Total jobs ever taken by agents this wallet owns (any status). */
  taken: number;
  /** Count of `Completed` jobs across owned agents. */
  completed: number;
  /** USDC microunits earned across completed jobs. */
  earnedMicro: bigint;
  /**
   * Sum of `getLastIndex` across every agentId this wallet owns. Counts
   * feedback ENTRIES (not stars / scores) since ERC-8004's index field is
   * a count, not a rating.
   */
  reputationCount: number;
  /** The agentId NFTs currently held by this wallet, ascending. */
  ownedAgentIds: bigint[];
}

export interface MyActivityData {
  asClient: ClientStats;
  asAgent: AgentStats;
}

export interface UseMyActivityResult {
  /**
   * Filtered & aggregated activity for the connected wallet. `null` if the
   * underlying data isn't ready yet OR if the wallet is disconnected (the
   * section component checks `isConnected` first and shows a connect CTA).
   */
  data: MyActivityData | null;
  /** The wallet we filtered against (passthrough from wagmi's useAccount). */
  address: `0x${string}` | undefined;
  /** Mirrors `useAccount().isConnected`. Surfaced here so the section component doesn't need its own useAccount call. */
  isConnected: boolean;
  isLoading: boolean;
  isError: boolean;
  /** Bubbles up to both useRecentJobs and useAgents refetches. */
  refetch: () => void;
}

/**
 * Case-insensitive address comparison. wagmi normally returns checksummed
 * (mixed-case) addresses from `useAccount`, and viem returns checksummed
 * addresses from contract reads. But the EVM doesn't care about case, so
 * lowercase both sides to be defensive against any cosmetic divergence.
 */
function sameAddress(
  a: `0x${string}` | undefined | null,
  b: `0x${string}` | undefined | null,
): boolean {
  if (!a || !b) return false;
  return a.toLowerCase() === b.toLowerCase();
}

export function useMyActivity(): UseMyActivityResult {
  const { address, isConnected } = useAccount();

  // ── Layer 1: canonical job list with timestamps + tx hashes ─────────
  //
  // No `limit` — we want every job to filter against. React Query dedupes
  // this with whatever other component triggered the same call (Jobs page,
  // Recent Jobs widget). Net new RPC: zero in steady state.
  const {
    jobs: allJobs,
    isLoading: jobsLoading,
    isError: jobsError,
    refetch: refetchJobs,
  } = useRecentJobs();

  // ── Layer 2: agentId → owner address map (+ reputation per agentId) ─
  //
  // `useAgents` already does the batched ownerOf and getLastIndex reads.
  // We piggyback on its result instead of re-running them here. Note we
  // grab the FULL agents array (not filtered to owner=wallet) because we
  // need to look up "who owns this agentId" for every job's agentId, even
  // ones the wallet doesn't own — to correctly EXCLUDE them from the As
  // Agent tab.
  const {
    agents,
    isLoading: agentsLoading,
    isError: agentsError,
    refetch: refetchAgents,
  } = useAgents();

  // ── Layer 3: derive the two views ───────────────────────────────────
  const data = useMemo<MyActivityData | null>(() => {
    // Need a wallet to filter against. The component renders a connect
    // CTA in this case — returning null here just keeps the type narrow.
    if (!address) return null;
    // Both upstream sources must have resolved (we use BOTH to filter).
    // `agents` can be an empty array when no jobs have happened yet;
    // that's a valid resolved state, distinct from null.
    if (allJobs == null || agents == null) return null;

    // ─ Build agentId → owner lookup once ────────────────────────────
    //
    // Stringify the bigint key because Map<bigint> doesn't dedupe by
    // value (same gotcha as in useJobStats / useAgents).
    const ownerByAgentId = new Map<string, `0x${string}` | null>();
    const reputationByAgentId = new Map<string, number>();
    for (const a of agents) {
      ownerByAgentId.set(a.agentId.toString(), a.owner);
      reputationByAgentId.set(a.agentId.toString(), a.reputationCount);
    }

    // ─ As Client filter + aggregates ────────────────────────────────
    let posted = 0;
    let spentMicro = 0n;
    let completed = 0;
    let rejected = 0;
    let expired = 0;
    const clientJobs: RecentJob[] = [];
    for (const j of allJobs) {
      if (!sameAddress(j.client, address)) continue;
      clientJobs.push(j);
      posted++;
      switch (j.status) {
        case JobStatus.Completed:
          spentMicro += j.bountyMicro;
          completed++;
          break;
        case JobStatus.Rejected:
          rejected++;
          break;
        case JobStatus.Expired:
          expired++;
          break;
      }
    }
    const terminal = completed + rejected + expired;
    const successRatePercent =
      terminal > 0 ? Math.round((completed / terminal) * 1000) / 10 : null;

    // ─ As Agent filter + aggregates ─────────────────────────────────
    let taken = 0;
    let completedAsAgent = 0;
    let earnedMicro = 0n;
    const agentJobs: RecentJob[] = [];
    const ownedAgentIdSet = new Set<string>();
    for (const j of allJobs) {
      const owner = ownerByAgentId.get(j.agentId.toString());
      if (!sameAddress(owner, address)) continue;
      agentJobs.push(j);
      ownedAgentIdSet.add(j.agentId.toString());
      taken++;
      if (j.status === JobStatus.Completed) {
        completedAsAgent++;
        earnedMicro += j.bountyMicro;
      }
    }

    // ─ Also include owned agentIds with ZERO jobs ──────────────────
    //
    // An agent NFT can be minted and held without ever being hired.
    // The "ownedAgentIds" array should reflect what the wallet HOLDS,
    // not just what shows up in `agentJobs`. Pull from the full
    // agents list and filter by owner.
    for (const a of agents) {
      if (sameAddress(a.owner, address)) {
        ownedAgentIdSet.add(a.agentId.toString());
      }
    }

    // ─ Reputation sum across owned agents ──────────────────────────
    let reputationCount = 0;
    for (const idStr of ownedAgentIdSet) {
      reputationCount += reputationByAgentId.get(idStr) ?? 0;
    }

    const ownedAgentIds = Array.from(ownedAgentIdSet)
      .map((s) => BigInt(s))
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

    return {
      asClient: {
        // useRecentJobs already returns jobId DESC; we filtered in
        // order so no re-sort needed.
        jobs: clientJobs,
        posted,
        spentMicro,
        successRatePercent,
      },
      asAgent: {
        jobs: agentJobs,
        taken,
        completed: completedAsAgent,
        earnedMicro,
        reputationCount,
        ownedAgentIds,
      },
    };
  }, [address, allJobs, agents]);

  return {
    data,
    address,
    isConnected,
    // We only have meaningful data once BOTH upstream queries have resolved.
    // When disconnected, isLoading is false because we render a connect CTA
    // instead of waiting for anything.
    isLoading: isConnected && (jobsLoading || agentsLoading),
    isError: jobsError || agentsError,
    refetch: () => {
      refetchJobs();
      refetchAgents();
    },
  };
}
