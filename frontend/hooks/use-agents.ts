"use client";

/**
 * Per-agent aggregation hook — layers IdentityRegistry ownership and
 * ReputationRegistry feedback counts on top of the canonical job list.
 *
 * Data flow (no new long-running scans — everything reuses cached reads):
 *   1. `useJobStats` → every job's struct (agentId, client, status, bounty)
 *   2. `useRecentJobs()` (no limit) → adds JobCreated timestamps so we can
 *      compute "Last Active" per agent
 *   3. Derive unique agentId list from the jobs
 *   4. Batched `useReadContracts` against `IdentityRegistry.ownerOf` —
 *      ONE RPC round trip for all owner addresses, not N+1 individual reads
 *   5. Derive unique (agentId, client) pairs from jobs (these are the only
 *      pairs that could possibly have feedback — clients only rate agents
 *      they hired)
 *   6. Batched `useReadContracts` against `ReputationRegistry.getLastIndex`
 *      for each pair; sum per agentId to get total feedback count
 *
 * The sort key is `usdcEarnedMicro DESC` — top earners first, matching how
 * the Agents page presents this. Agents with zero completions still appear
 * (their bounty sum is 0n), just at the bottom.
 *
 * Empty/missing data is rendered explicitly (owner null = unknown, last
 * active null = "—") rather than dropping the agent from the list.
 */

import { useMemo } from "react";
import { useReadContracts } from "wagmi";
import { CHAIN_ID, CONTRACT_ADDRESSES } from "@/lib/contracts";
import { IDENTITY_REGISTRY_ABI } from "@/lib/abi/identity-registry";
import { REPUTATION_REGISTRY_ABI } from "@/lib/abi/reputation-registry";
import { JobStatus, useJobStats } from "@/hooks/use-job-stats";
import { useRecentJobs } from "@/hooks/use-recent-jobs";

export interface Agent {
  /** ERC-8004 NFT tokenId. */
  agentId: bigint;
  /**
   * Current `ownerOf` from the IdentityRegistry. `null` if the read failed
   * (e.g. token was burned, RPC hiccup). UI renders "—" in that case.
   */
  owner: `0x${string}` | null;
  /** Count of jobs in `Completed` state for this agent. */
  jobsCompleted: number;
  /** Sum of all jobs (any state) involving this agent — context for the row. */
  totalJobs: number;
  /** USDC earned by this agent, in microunits (6 decimals). */
  usdcEarnedMicro: bigint;
  /**
   * Unix seconds of the most recent `JobCreated` event mentioning this
   * agent. `null` if the timestamp lookup hasn't resolved yet.
   */
  lastJobAt: number | null;
  /**
   * Total feedback entries across every (this agentId, any client) pair
   * we've seen, via `ReputationRegistry.getLastIndex`. Returns 0 when no
   * client has yet rated this agent.
   */
  reputationCount: number;
  /**
   * Every jobId that mentions this agent, newest first. Used by the row
   * detail panel to enumerate "worked on: Job #1, Job #2".
   */
  jobIds: bigint[];
}

export interface UseAgentsResult {
  agents: Agent[] | null;
  isLoading: boolean;
  isError: boolean;
  /** Re-run the on-chain reads (ownerOf + getLastIndex). */
  refetch: () => void;
}

export function useAgents(): UseAgentsResult {
  const {
    stats,
    isLoading: statsLoading,
    isError: statsError,
  } = useJobStats();

  // Pull all jobs (no limit) for accurate Last Active per agent. React
  // Query dedupes this with the same call made elsewhere in the dashboard.
  const {
    jobs: recentJobs,
    isLoading: recentJobsLoading,
    isError: recentJobsError,
  } = useRecentJobs();

  // ── Step 1: derive unique agentIds (sorted asc for stable batch order) ─
  const agentIds = useMemo<bigint[]>(() => {
    if (!stats) return [];
    // Stringify into a Set because Set<bigint> doesn't dedupe by value.
    const set = new Set<string>();
    for (const j of stats.jobs) set.add(j.agentId.toString());
    return Array.from(set)
      .map((s) => BigInt(s))
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  }, [stats]);

  // ── Step 2: batched ownerOf reads ──────────────────────────────────────
  //
  // Memoize the contracts array — wagmi v2's `useReadContracts` treats a
  // new array reference as a new query and triggers a re-fetch, which
  // produces a new `data` reference, which re-renders consumers, which
  // re-calls this hook, which creates a new contracts array... a tight
  // infinite render loop. Stabilizing the array via useMemo on the only
  // real dep (`agentIds`) breaks the cycle. Without this, child rows that
  // hold their own useState (like AgentRow's `expanded`) get their state
  // reset 15–30× per second.
  const ownerContracts = useMemo(
    () =>
      agentIds.map(
        (id) =>
          ({
            address: CONTRACT_ADDRESSES.identityRegistry,
            abi: IDENTITY_REGISTRY_ABI,
            functionName: "ownerOf",
            args: [id],
            chainId: CHAIN_ID,
          }) as const,
      ),
    [agentIds],
  );
  const ownerReads = useReadContracts({
    contracts: ownerContracts,
    query: { enabled: agentIds.length > 0 },
  });

  // ── Step 3: derive (agentId, JobEscrow) pairs for reputation lookup ───
  //
  // IMPORTANT: ReputationRegistry.getLastIndex takes (agentId,
  // clientAddress) where `clientAddress` is the contract or EOA that
  // CALLED giveFeedback — i.e. msg.sender at write time. For Forge,
  // JobEscrow.complete() is the only path that emits feedback, and
  // inside that call JobEscrow is the msg.sender to the registry. So
  // the "client" address from the registry's POV is always
  // `CONTRACT_ADDRESSES.jobEscrow`, NOT the original job's client EOA.
  //
  // Empirical confirmation (Arc testnet, 2026-05-18):
  //   getLastIndex(14776, deployerEOA)  = 0
  //   getLastIndex(14776, jobEscrow)    = 1  ← actual feedback count
  //
  // Documented in `reference_arc_addresses.md` (Frontend pitfalls).
  const repPairs = useMemo<Array<{ agentId: bigint; client: `0x${string}` }>>(
    () =>
      agentIds.map((id) => ({
        agentId: id,
        client: CONTRACT_ADDRESSES.jobEscrow,
      })),
    [agentIds],
  );

  // ── Step 4: batched getLastIndex reads ─────────────────────────────────
  //
  // Memoized for the same reason as ownerContracts above — see the
  // detailed note there.
  const reputationContracts = useMemo(
    () =>
      repPairs.map(
        ({ agentId, client }) =>
          ({
            address: CONTRACT_ADDRESSES.reputationRegistry,
            abi: REPUTATION_REGISTRY_ABI,
            functionName: "getLastIndex",
            args: [agentId, client],
            chainId: CHAIN_ID,
          }) as const,
      ),
    [repPairs],
  );
  const reputationReads = useReadContracts({
    contracts: reputationContracts,
    query: { enabled: repPairs.length > 0 },
  });

  // ── Step 5: aggregate everything into Agent rows ───────────────────────
  //
  // CRITICAL: once `stats` resolves we ALWAYS return a populated array,
  // even while ownerReads is still in flight. Earlier this hook flipped
  // `agents` between `null` (while loading owners) and the array (when
  // done). Each flip caused the parent table's JSX subtree to swap
  // between Skeleton rows and real rows, which unmounted AgentRow and
  // reset its `expanded: useState` to false — making row expansion
  // appear to do nothing because each click was immediately followed
  // by an unmount/remount on the next render cycle.
  //
  // Rows whose owner hasn't resolved yet just carry `owner: null`,
  // which the UI renders as "—". Same for reputation. Both fill in
  // progressively as the batched reads return.
  const agents = useMemo<Agent[] | null>(() => {
    if (!stats) return null;
    if (stats.jobs.length === 0) return [];
    // Note: ownerReads.isLoading is NO LONGER a gate. Reputation reads
    // weren't gating already.

    // ─ Map jobs by agentId (single pass over the canonical list) ─────────
    const completedByAgentId = new Map<string, number>();
    const earnedByAgentId = new Map<string, bigint>();
    const totalByAgentId = new Map<string, number>();
    for (const j of stats.jobs) {
      const key = j.agentId.toString();
      totalByAgentId.set(key, (totalByAgentId.get(key) ?? 0) + 1);
      if (j.status === JobStatus.Completed) {
        completedByAgentId.set(key, (completedByAgentId.get(key) ?? 0) + 1);
        earnedByAgentId.set(
          key,
          (earnedByAgentId.get(key) ?? 0n) + j.bountyMicro,
        );
      }
    }

    // ─ Owner address per agentId ─────────────────────────────────────────
    const ownerByAgentId = new Map<string, `0x${string}`>();
    ownerReads.data?.forEach((r, i) => {
      if (r.status === "success" && r.result != null) {
        ownerByAgentId.set(agentIds[i].toString(), r.result as `0x${string}`);
      }
    });

    // ─ Reputation count per agentId (sum across clients) ─────────────────
    //
    // We cast through `unknown` because wagmi narrows the contracts-tuple
    // type when the array is empty (`enabled: repPairs.length > 0` gates
    // it). The cast picks the union shape returned by useReadContracts
    // for any reads — { status: 'success', result: bigint } | { status:
    // 'failure', error: Error }.
    const reputationByAgentId = new Map<string, number>();
    const repData = reputationReads.data as unknown as
      | Array<
          | { status: "success"; result: bigint }
          | { status: "failure"; error: Error }
        >
      | undefined;
    repData?.forEach((r, i) => {
      if (r.status === "success" && r.result != null) {
        const pair = repPairs[i];
        const key = pair.agentId.toString();
        // result is uint64 → bigint in viem; safe to Number() since
        // feedback counts will never approach 2^53.
        const count = Number(r.result);
        reputationByAgentId.set(key, (reputationByAgentId.get(key) ?? 0) + count);
      }
    });

    // ─ Last active + jobIds list (from recentJobs which has timestamps) ──
    const lastActiveByAgentId = new Map<string, number>();
    const jobIdsByAgentId = new Map<string, bigint[]>();
    if (recentJobs) {
      for (const j of recentJobs) {
        const key = j.agentId.toString();
        if (j.createdAtSeconds != null) {
          const prev = lastActiveByAgentId.get(key);
          if (prev == null || j.createdAtSeconds > prev) {
            lastActiveByAgentId.set(key, j.createdAtSeconds);
          }
        }
        const list = jobIdsByAgentId.get(key) ?? [];
        list.push(j.jobId);
        jobIdsByAgentId.set(key, list);
      }
    }

    // ─ Build and sort ────────────────────────────────────────────────────
    const out: Agent[] = agentIds.map((id) => {
      const key = id.toString();
      const jobs = jobIdsByAgentId.get(key) ?? [];
      // Sort the per-agent job list newest-first (jobIds increase with time).
      jobs.sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
      return {
        agentId: id,
        owner: ownerByAgentId.get(key) ?? null,
        jobsCompleted: completedByAgentId.get(key) ?? 0,
        totalJobs: totalByAgentId.get(key) ?? 0,
        usdcEarnedMicro: earnedByAgentId.get(key) ?? 0n,
        lastJobAt: lastActiveByAgentId.get(key) ?? null,
        reputationCount: reputationByAgentId.get(key) ?? 0,
        jobIds: jobs,
      };
    });

    // Sort: USDC earned DESC, then agentId ASC as a stable tiebreaker.
    out.sort((a, b) => {
      if (a.usdcEarnedMicro !== b.usdcEarnedMicro) {
        return a.usdcEarnedMicro < b.usdcEarnedMicro ? 1 : -1;
      }
      return a.agentId < b.agentId ? -1 : a.agentId > b.agentId ? 1 : 0;
    });
    return out;
  }, [
    stats,
    agentIds,
    ownerReads.data,
    reputationReads.data,
    repPairs,
    recentJobs,
  ]);

  return {
    agents,
    // Loading is true ONLY while the canonical jobs list hasn't resolved
    // yet. Once we have it, the table renders rows with placeholder owners
    // ("—") that fill in as `ownerReads` resolves. This avoids the JSX
    // subtree toggle that was unmounting AgentRow on every owner-fetch
    // tick and resetting its `expanded` state.
    isLoading: statsLoading || recentJobsLoading,
    isError:
      statsError ||
      recentJobsError ||
      ownerReads.isError ||
      reputationReads.isError,
    refetch: () => {
      void ownerReads.refetch();
      void reputationReads.refetch();
    },
  };
}
