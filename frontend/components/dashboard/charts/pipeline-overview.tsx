"use client";

/**
 * Job Lifecycle stats — live counts per status bucket and total USDC
 * currently locked in escrow.
 *
 * Data sources (no new RPC reads beyond what other dashboard components
 * already make):
 *   - `useJobStats` provides per-status counts (funded, submitted, etc.)
 *     and `totalEscrowedMicro` — the sum of bounties for jobs whose escrow
 *     hasn't been released yet (Funded + Submitted).
 *   - `usePaymentHistory` provides `completed24h` — a rolling-window count
 *     of payments released in the last 24 hours. `complete()` is the only
 *     call that emits `PaymentReleased`, so this is exactly "jobs completed
 *     in the last 24h." Reusing the chart's cached data avoids a second
 *     `getLogs` scan.
 *
 * Bar widths:
 *   - Funded / Submitted bars share a denominator of `funded + submitted`
 *     so they visually partition "currently-active escrow" — they stack
 *     conceptually, not against the lifetime total.
 *   - Completed (24h) bar is binary: full when count > 0, empty when 0.
 *     There's no meaningful denominator for a rolling-window count, so
 *     "is there activity today?" is the question the bar answers.
 *
 * Empty / quiet state: when nothing is locked (totalEscrowed = 0) and no
 * recent completions, the card renders all zeros with 0%-width bars.
 * That's the honest "no current activity" story — we deliberately do NOT
 * fake content to fill the space.
 */

import { Skeleton } from "@/components/ui/skeleton";
import { useJobStats } from "@/hooks/use-job-stats";
import { usePaymentHistory } from "@/hooks/use-payment-history";
import { formatUnits } from "viem";

/**
 * Same helper as overview.tsx — `formatUnits` strips trailing zeros so we
 * wrap it with `toLocaleString` to always show two decimals and add the
 * thousands separator. Duplicated rather than imported because two files
 * doesn't yet earn a shared util module; revisit on the third caller.
 */
function formatUsdc(microUnits: bigint): string {
  return Number(formatUnits(microUnits, 6)).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function PipelineOverview() {
  const { stats, isLoading: statsLoading, isError: statsError } = useJobStats();
  const {
    completed24h,
    isLoading: paymentsLoading,
    isError: paymentsError,
  } = usePaymentHistory();

  // The card stays in a unified loading state until BOTH data sources land.
  // We treat error as loading-equivalent for the bars (skeleton) since the
  // alternative is partial-render with mismatched real/fake numbers — worse
  // than a uniform "fetching…" state.
  const loading =
    statsLoading || statsError || paymentsLoading || paymentsError;

  // Derive bar widths. Both null-checked because `stats` is null until the
  // first read resolves.
  const funded = stats?.funded ?? 0;
  const submitted = stats?.submitted ?? 0;
  const activeTotal = funded + submitted;
  const fundedPercent = activeTotal > 0 ? (funded / activeTotal) * 100 : 0;
  const submittedPercent =
    activeTotal > 0 ? (submitted / activeTotal) * 100 : 0;

  // Completed (24h): bar is full when any payments landed in the window,
  // empty otherwise. See module doc-comment for rationale.
  const completedToday = completed24h ?? 0;
  const completedPercent = completedToday > 0 ? 100 : 0;

  const totalEscrowed = stats ? formatUsdc(stats.totalEscrowedMicro) : "—";

  // Each row's data — kept as a list so the JSX below stays readable.
  // `showPercent` controls whether we display the `XX%` chip; we hide it
  // for "Completed (24h)" since the binary-fill bar already conveys the
  // signal and a "100%" reading would invite misinterpretation.
  const stages = [
    {
      name: "Funded",
      count: funded,
      percent: fundedPercent,
      color: "bg-muted-foreground",
      showPercent: true,
    },
    {
      name: "Submitted",
      count: submitted,
      percent: submittedPercent,
      color: "bg-chart-1",
      showPercent: true,
    },
    {
      name: "Completed (24h)",
      count: completedToday,
      percent: completedPercent,
      color: "bg-success",
      showPercent: false,
    },
  ];

  return (
    <div className="bg-card border border-border rounded-xl p-5 h-[380px] animate-in fade-in slide-in-from-bottom-4 duration-500 delay-100">
      <div className="mb-6">
        <h3 className="text-base font-semibold text-foreground">
          Job Lifecycle
        </h3>
        <p className="text-sm text-muted-foreground mt-0.5">
          Active jobs by state
        </p>
      </div>

      <div className="space-y-5">
        {stages.map((stage, index) => (
          <div key={stage.name} className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-foreground">
                {stage.name}
              </span>
              <div className="flex items-center gap-2">
                {loading ? (
                  // Numeric placeholder: roughly the width of a 2-digit count
                  <Skeleton className="h-4 w-6 bg-secondary" />
                ) : (
                  <span className="text-sm font-mono text-muted-foreground">
                    {stage.count}
                  </span>
                )}
                {stage.showPercent && !loading && (
                  <span className="text-sm font-semibold text-foreground">
                    {Math.round(stage.percent)}%
                  </span>
                )}
              </div>
            </div>
            <div className="h-2 bg-secondary rounded-full overflow-hidden">
              <div
                className={`h-full ${stage.color} rounded-full transition-all duration-1000 ease-out`}
                style={{
                  // Bar width animates from 0 → target on data-resolve.
                  // While loading, both states are 0% so the bar stays in
                  // the gray track — Skeleton on the number is enough of a
                  // signal that we're fetching.
                  width: loading ? "0%" : `${stage.percent}%`,
                  transitionDelay: `${index * 150}ms`,
                }}
              />
            </div>
          </div>
        ))}
      </div>

      {/* Total escrowed value */}
      <div className="mt-6 pt-5 border-t border-border">
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">Total Escrowed</span>
          {loading ? (
            <Skeleton className="h-7 w-24 bg-secondary" />
          ) : (
            <span className="text-xl font-bold font-mono text-foreground">
              {totalEscrowed}{" "}
              <span className="text-sm font-normal text-muted-foreground">
                USDC
              </span>
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
