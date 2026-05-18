"use client";

/**
 * USDC Volume chart — live PaymentReleased events from JobEscrow.
 *
 * Three render branches:
 *   - loading: muted skeleton placeholder matching the chart's footprint
 *   - empty (0 events): "be the first" CTA, no chart frame
 *   - sparse (1 day of activity): show the lone data point as a headline
 *     rather than a degenerate single-segment area chart (recharts can't
 *     draw a meaningful trend from one point)
 *   - normal (≥2 days): the actual AreaChart
 *
 * Decision: do NOT zero-pad missing days. If a day has no payments, it is
 * simply absent from the series. That's honest — gaps in the timeline
 * reflect actual quiet stretches on-chain, not a "lack of data" we're
 * hiding from the user.
 */

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { Skeleton } from "@/components/ui/skeleton";
import { usePaymentHistory } from "@/hooks/use-payment-history";

export function RevenueChart() {
  const { data, isLoading, isError } = usePaymentHistory();

  const renderBody = () => {
    // Treat error like loading — keep the visual layout stable. We could
    // surface a retry button later; for now the user is shielded from raw
    // RPC failures the same way the metric cards are.
    if (isLoading || isError) {
      return (
        <div className="h-[280px] flex items-center justify-center">
          <Skeleton className="h-[240px] w-full bg-secondary" />
        </div>
      );
    }

    if (!data || data.length === 0) {
      return (
        <div className="h-[280px] flex flex-col items-center justify-center text-center px-6">
          <p className="text-sm text-muted-foreground">
            No payments yet — be the first.
          </p>
          <p className="text-xs text-muted-foreground/70 mt-2 max-w-xs">
            Daily volume will appear here as agents complete jobs and the
            client releases payment.
          </p>
        </div>
      );
    }

    if (data.length === 1) {
      // recharts will technically render an AreaChart with one point, but the
      // result is invisible (no line, no area). Show the value as a headline
      // instead — more useful than a blank canvas.
      const only = data[0];
      return (
        <div className="h-[280px] flex flex-col items-center justify-center text-center px-6">
          <p className="text-xs text-muted-foreground uppercase tracking-wide">
            {only.label}
          </p>
          <p className="font-mono text-3xl lg:text-4xl font-bold text-foreground mt-2">
            {only.volume.toLocaleString("en-US", {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}{" "}
            <span className="text-base text-muted-foreground">USDC</span>
          </p>
          <p className="text-xs text-muted-foreground/70 mt-3 max-w-xs">
            Showing 1 day of activity — chart fills in as more payments land.
          </p>
        </div>
      );
    }

    return (
      <div className="h-[280px] animate-in fade-in duration-700">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={data}
            margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
          >
            <defs>
              <linearGradient id="volumeGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#5b9dff" stopOpacity={0.4} />
                <stop offset="100%" stopColor="#5b9dff" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="oklch(0.20 0.02 250)"
              vertical={false}
            />
            <XAxis
              dataKey="label"
              axisLine={false}
              tickLine={false}
              tick={{ fill: "oklch(0.60 0.02 250)", fontSize: 12 }}
              dy={10}
            />
            <YAxis
              axisLine={false}
              tickLine={false}
              tick={{
                fill: "oklch(0.60 0.02 250)",
                fontSize: 12,
                fontFamily: "JetBrains Mono, monospace",
              }}
              tickFormatter={(value: number) =>
                // Compact-format larger numbers ("1.2k") once we have meaningful
                // volume; for sub-1000 ranges show the raw value.
                value >= 1000 ? `${(value / 1000).toFixed(1)}k` : `${value}`
              }
              dx={-10}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "oklch(0.11 0.02 250)",
                border: "1px solid oklch(0.20 0.02 250)",
                borderRadius: "8px",
                fontSize: "12px",
                fontFamily: "JetBrains Mono, monospace",
              }}
              labelStyle={{ color: "oklch(0.95 0 0)", fontWeight: 600 }}
              itemStyle={{ color: "oklch(0.60 0.02 250)" }}
              formatter={(value: number) => [
                `${value.toLocaleString("en-US", {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })} USDC`,
                "",
              ]}
            />
            <Area
              type="monotone"
              dataKey="volume"
              stroke="#5b9dff"
              strokeWidth={2}
              fill="url(#volumeGradient)"
              dot={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    );
  };

  return (
    <div className="bg-card border border-border rounded-xl p-5 h-[380px] animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="text-base font-semibold text-foreground">
            USDC Volume
          </h3>
          <p className="text-sm text-muted-foreground mt-0.5">
            Daily USDC paid to agents
          </p>
        </div>
        <div className="flex items-center gap-4 text-xs">
          <div className="flex items-center gap-1.5">
            <div className="w-2.5 h-2.5 rounded-full bg-chart-1" />
            <span className="text-muted-foreground">Volume</span>
          </div>
        </div>
      </div>

      {renderBody()}
    </div>
  );
}
