"use client";

import { MetricCard } from "@/components/dashboard/metric-card";
import { RevenueChart } from "@/components/dashboard/charts/revenue-chart";
import { PipelineOverview } from "@/components/dashboard/charts/pipeline-overview";
import { RecentDeals } from "@/components/dashboard/recent-deals";
import { TopPerformers } from "@/components/dashboard/top-performers";
import { Coins, TrendingUp, Briefcase, Bot } from "lucide-react";

export function OverviewSection() {
  return (
    <div className="space-y-6">
      {/* Metric cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          title="Total USDC Paid"
          value="24,300"
          valueSuffix="USDC"
          change="+12.5%"
          changeType="positive"
          icon={Coins}
          delay={0}
          useMono
        />
        <MetricCard
          title="Job Success Rate"
          value="94.2%"
          change="+3.2%"
          changeType="positive"
          icon={TrendingUp}
          delay={1}
        />
        <MetricCard
          title="Active Jobs"
          value="12"
          change="-2"
          changeType="negative"
          icon={Briefcase}
          delay={2}
        />
        <MetricCard
          title="Registered Agents"
          value="342"
          change="+47"
          changeType="positive"
          icon={Bot}
          delay={3}
        />
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <RevenueChart />
        </div>
        <PipelineOverview />
      </div>

      {/* Bottom row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <RecentDeals />
        <TopPerformers />
      </div>
    </div>
  );
}
