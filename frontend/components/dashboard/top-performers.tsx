"use client";

/**
 * Top Agents leaderboard — Phase 6.2 (reactivation of Phase 4f).
 *
 * Pure presentation layer over `useAgents()`. No new RPC reads, no
 * fresh aggregation logic — `use-agents.ts` already computes
 * `usdcEarnedMicro` and `jobsCompleted` per agentId, and is already
 * sorted by `usdcEarnedMicro` DESC with `agentId` ASC as the
 * tiebreaker (see hooks/use-agents.ts lines 283-289). We slice the
 * top N, filter to agents that have actually earned, and render.
 *
 * **Why no separate `use-top-agents.ts` hook:** the aggregation was
 * inadvertently done as part of Phase 5c (Agents section). YAGNI on
 * a specialized hook until specialized aggregation is required.
 * Consuming `useAgents` directly also means the leaderboard and the
 * Agents table never disagree on who's #1.
 *
 * **Source of truth for earnings:** sum of `bountyMicro` for jobs
 * where `status === JobStatus.Completed`, attributed by the stored
 * `agentId` field. This matches PaymentReleased event emission
 * exactly (same on-chain trigger), without needing a chunked log
 * scan. See `hooks/use-agents.ts` line 199-212 for the aggregation.
 *
 * **No "+47 rep" trend column:** we have no day-over-day snapshots
 * (no indexer yet). Same reasoning as `overview.tsx` dropping v0's
 * +12.5% trend chips — fabricated metrics are worse than missing
 * ones. Reintroduce when an indexer ships.
 */

import { Trophy } from "lucide-react";
import { formatUnits } from "viem";

import { useAgents, type Agent } from "@/hooks/use-agents";
import { Skeleton } from "@/components/ui/skeleton";
import { CONTRACT_ADDRESSES } from "@/lib/contracts";
import { arcTestnet } from "@/lib/chains";

const EXPLORER_URL = arcTestnet.blockExplorers?.default.url ?? "";

/**
 * How many agents to show. We clamp; if fewer than N have actually
 * earned via completed jobs, we render only what we have (filtered
 * by `jobsCompleted > 0`).
 */
const TOP_N = 5;

/**
 * Format USDC microunits (6 decimals) as a human string with always
 * 2 decimals: 1_000_000n → "1.00". Local copy to keep this component
 * self-contained — same logic lives in `overview.tsx` and the
 * dialogs; consolidating to a shared util is a future cleanup.
 */
function formatUsdc(microUnits: bigint): string {
  return Number(formatUnits(microUnits, 6)).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function truncateAddress(addr: string, head = 6, tail = 4): string {
  if (addr.length <= head + tail + 2) return addr;
  return `${addr.slice(0, head + 2)}…${addr.slice(-tail)}`;
}

/**
 * Arcscan deep-link for an ERC-721 token (the agent NFT). Follows
 * the Etherscan convention `/token/<contract>?a=<id>` that Arcscan
 * inherits. If the explorer doesn't recognize the `?a=` query for
 * a given agentId it falls back to the IdentityRegistry contract
 * page — still informative.
 */
function agentNftUrl(agentId: bigint): string {
  return `${EXPLORER_URL}/token/${CONTRACT_ADDRESSES.identityRegistry}?a=${agentId.toString()}`;
}

export function TopPerformers() {
  const { agents, isLoading, isError } = useAgents();

  // useAgents is already sorted (USDC earned DESC, agentId ASC). We
  // filter out agents with no completed jobs — registered-but-idle
  // agents shouldn't appear on the leaderboard — then take the top N.
  const top = (agents ?? [])
    .filter((a) => a.jobsCompleted > 0)
    .slice(0, TOP_N);

  return (
    <div className="bg-card border border-border rounded-xl p-5 animate-in fade-in slide-in-from-bottom-4 duration-500 delay-300">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h3 className="text-base font-semibold text-foreground">Top Agents</h3>
          <p className="text-sm text-muted-foreground mt-0.5">
            By total USDC earned
          </p>
        </div>
        <div className="flex items-center gap-1 text-warning">
          <Trophy className="w-5 h-5" />
        </div>
      </div>

      {isLoading && (
        <div className="space-y-3">
          {Array.from({ length: TOP_N }).map((_, i) => (
            <TopRowSkeleton key={i} delay={i} />
          ))}
        </div>
      )}

      {!isLoading && isError && (
        <div className="text-center py-8 text-sm text-muted-foreground">
          Couldn&apos;t load top agents — check your network and refresh.
        </div>
      )}

      {!isLoading && !isError && top.length === 0 && (
        <div className="text-center py-8 text-sm text-muted-foreground">
          No completed jobs yet.
        </div>
      )}

      {!isLoading && !isError && top.length > 0 && (
        <div className="space-y-3">
          {top.map((agent, index) => (
            <TopRow
              key={agent.agentId.toString()}
              agent={agent}
              rank={index + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* ─── Row + skeleton ─────────────────────────────────────────────── */

function TopRow({ agent, rank }: { agent: Agent; rank: number }) {
  const ownerLabel = agent.owner ? truncateAddress(agent.owner) : "—";
  const jobsLabel = `${agent.jobsCompleted} ${agent.jobsCompleted === 1 ? "job" : "jobs"}`;
  return (
    <a
      href={agentNftUrl(agent.agentId)}
      target="_blank"
      rel="noopener noreferrer"
      className="group flex items-center justify-between p-3 rounded-lg hover:bg-secondary/50 transition-colors animate-in fade-in slide-in-from-right-2"
      style={{
        animationDelay: `${(rank + 3) * 100}ms`,
        animationFillMode: "both",
      }}
    >
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-full bg-secondary flex items-center justify-center text-sm font-bold text-muted-foreground font-mono">
          {rank}
        </div>
        <div>
          <p className="text-sm font-medium text-foreground font-mono">
            #{agent.agentId.toString()}
          </p>
          <p className="text-xs text-muted-foreground font-mono">
            {ownerLabel}
          </p>
        </div>
      </div>
      <div className="text-right">
        <p className="text-sm font-semibold font-mono text-foreground">
          {formatUsdc(agent.usdcEarnedMicro)}{" "}
          <span className="text-xs text-muted-foreground">USDC</span>
        </p>
        <p className="text-xs text-muted-foreground">{jobsLabel}</p>
      </div>
    </a>
  );
}

function TopRowSkeleton({ delay }: { delay: number }) {
  return (
    <div
      className="flex items-center justify-between p-3 rounded-lg animate-in fade-in slide-in-from-right-2"
      style={{
        animationDelay: `${(delay + 3) * 100}ms`,
        animationFillMode: "both",
      }}
    >
      <div className="flex items-center gap-3">
        <Skeleton className="w-10 h-10 rounded-full bg-secondary" />
        <div className="space-y-1.5">
          <Skeleton className="h-3.5 w-16 bg-secondary" />
          <Skeleton className="h-3 w-24 bg-secondary" />
        </div>
      </div>
      <div className="text-right space-y-1.5">
        <Skeleton className="h-3.5 w-20 bg-secondary ml-auto" />
        <Skeleton className="h-3 w-12 bg-secondary ml-auto" />
      </div>
    </div>
  );
}
