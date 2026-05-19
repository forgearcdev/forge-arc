"use client";

import { formatUnits } from "viem";
import { MetricCard } from "@/components/dashboard/metric-card";
import { RevenueChart } from "@/components/dashboard/charts/revenue-chart";
import { PipelineOverview } from "@/components/dashboard/charts/pipeline-overview";
import { RecentDeals } from "@/components/dashboard/recent-deals";
// Phase 6.2: TopPerformers re-enabled. The component is now a pure
// presentation layer over `useAgents` (which already computes
// `usdcEarnedMicro` + `jobsCompleted` per agentId — see
// hooks/use-agents.ts:199-212). No new RPC reads, no new hook.
import { TopPerformers } from "@/components/dashboard/top-performers";
import { Coins, TrendingUp, Briefcase, Bot } from "lucide-react";
import { useJobStats } from "@/hooks/use-job-stats";

/**
 * Format USDC microunits (6 decimals) as a human-readable string with
 * 2 decimal places: 1_000_000n → "1.00", 1_234_567_890n → "1,234.57".
 *
 * Avoids `formatUnits` returning naked "1" for round amounts (it strips
 * trailing zeros) — we always show at least cents.
 */
function formatUsdc(microUnits: bigint): string {
  return Number(formatUnits(microUnits, 6)).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function OverviewSection() {
  const { stats, isLoading, isError } = useJobStats();

  // On error we still render the cards (with em-dashes) rather than vanishing
  // — the rest of the dashboard should keep working even if a single RPC
  // hiccup nukes our reads.
  const totalPaid = stats ? formatUsdc(stats.totalPaidMicro) : "—";
  const successRate =
    stats?.successRatePercent == null
      ? "—"
      : `${stats.successRatePercent}%`;
  const activeJobs = stats ? stats.activeJobs.toString() : "—";
  const uniqueAgents = stats ? stats.uniqueAgents.toString() : "—";

  // No fake trend indicators (no historical comparison data yet). We removed
  // the +12.5% / +3.2% / -2 / +47 chips from v0's design. Trends will come
  // back once we have an indexer with day-over-day snapshots — see
  // frontend_contract_integration_plan.md.

  return (
    <div className="space-y-6">
      {/* Metric cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          title="Total USDC Paid"
          value={totalPaid}
          valueSuffix="USDC"
          icon={Coins}
          delay={0}
          useMono
          loading={isLoading || isError}
        />
        <MetricCard
          title="Job Success Rate"
          value={successRate}
          icon={TrendingUp}
          delay={1}
          loading={isLoading || isError}
        />
        <MetricCard
          title="Active Jobs"
          value={activeJobs}
          icon={Briefcase}
          delay={2}
          loading={isLoading || isError}
        />
        <MetricCard
          title="Registered Agents"
          value={uniqueAgents}
          icon={Bot}
          delay={3}
          loading={isLoading || isError}
        />
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <RevenueChart />
        </div>
        <PipelineOverview />
      </div>

      {/* Bottom row — two cards side-by-side on desktop, stacked on
       * mobile. RecentDeals on the left (wider information density),
       * TopPerformers on the right. Reactivated in Phase 6.2; was
       * collapsed to single-column during Phase 4e while Top Agents
       * was hidden.
       */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <RecentDeals />
        <TopPerformers />
      </div>
    </div>
  );
}
