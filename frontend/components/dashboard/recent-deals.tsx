"use client";

/**
 * Recent Jobs table — live rows from JobEscrow state.
 *
 * Replaces the v0 mock job slugs ("Code review by summarizer-v2") with the
 * real on-chain truth: jobId, agentId, bounty in USDC, status, and a
 * relative "X hours ago" timestamp derived from the JobCreated event's
 * block timestamp.
 *
 * What we deliberately DO NOT show (yet):
 *   - Friendly task titles — the contract has no task-name field, only
 *     `deliverableURI`. Rather than fake a title, the row uses "Job #N".
 *   - Agent owner address — would require a per-row ownerOf() call against
 *     the IdentityRegistry (N+1 RPC reads). With only 2 jobs that's fine,
 *     but with N=100 it's a foot-gun. Skipping until we need it.
 *
 * Render branches (mutually exclusive):
 *   - loading: 5 skeleton rows matching the live row footprint
 *   - error: friendly summary + Retry, same pattern as RevenueChart
 *   - empty (zero jobs): "No jobs yet" CTA
 *   - normal: the live rows, newest first, capped at `limit` (default 5)
 */

import { cn } from "@/lib/utils";
import {
  ArrowUpRight,
  CheckCircle2,
  Clock,
  XCircle,
  Wallet,
  Send,
  Bot,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { formatUnits } from "viem";
import { Skeleton } from "@/components/ui/skeleton";
import { useRecentJobs, type RecentJob } from "@/hooks/use-recent-jobs";
import { JobStatus } from "@/hooks/use-job-stats";

/**
 * Per-status icon, palette, and label. Keys are the numeric JobStatus enum
 * values so the lookup is `STATUS_CONFIG[job.status]` without a string
 * conversion. `None` is omitted because we filter those out upstream.
 */
const STATUS_CONFIG: Record<
  Exclude<JobStatus, 0>,
  {
    icon: typeof CheckCircle2;
    color: string;
    bg: string;
    label: string;
  }
> = {
  [JobStatus.Funded]: {
    icon: Wallet,
    color: "text-muted-foreground",
    bg: "bg-secondary",
    label: "Funded",
  },
  [JobStatus.Submitted]: {
    icon: Send,
    color: "text-accent",
    bg: "bg-accent/10",
    label: "Submitted",
  },
  [JobStatus.Completed]: {
    icon: CheckCircle2,
    color: "text-success",
    bg: "bg-success/10",
    label: "Completed",
  },
  [JobStatus.Rejected]: {
    icon: XCircle,
    color: "text-destructive",
    bg: "bg-destructive/10",
    label: "Rejected",
  },
  [JobStatus.Expired]: {
    icon: Clock,
    color: "text-muted-foreground",
    bg: "bg-secondary",
    label: "Expired",
  },
};

/**
 * Render the bounty as "1.00" (always two decimals). Same convention as
 * overview.tsx / pipeline-overview.tsx — we deliberately don't share a
 * util module until a third caller earns it.
 */
function formatUsdc(microUnits: bigint): string {
  return Number(formatUnits(microUnits, 6)).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * "X hours/days ago" formatting. Falls back to "—" when the JobCreated log
 * lookup didn't yield a timestamp (defensive — shouldn't happen on a
 * healthy contract).
 */
function relativeTime(seconds: number | null): string {
  if (seconds == null) return "—";
  return formatDistanceToNow(new Date(seconds * 1000), { addSuffix: true });
}

export function RecentDeals() {
  const { jobs, isLoading, isError, refetch } = useRecentJobs({ limit: 5 });

  const renderBody = () => {
    if (isLoading) {
      // Five rows of the same height as a live row keeps the card from
      // jumping when data lands.
      return (
        <div className="space-y-3">
          {Array.from({ length: 5 }, (_, i) => (
            <div
              key={i}
              className="flex items-center justify-between p-3 rounded-lg"
            >
              <div className="flex items-center gap-3">
                <Skeleton className="w-10 h-10 rounded-lg bg-secondary" />
                <div className="space-y-2">
                  <Skeleton className="h-3 w-24 bg-secondary" />
                  <Skeleton className="h-3 w-32 bg-secondary" />
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Skeleton className="h-4 w-16 bg-secondary" />
                <Skeleton className="h-6 w-20 rounded-md bg-secondary" />
              </div>
            </div>
          ))}
        </div>
      );
    }

    if (isError) {
      return (
        <div className="py-8 flex flex-col items-center justify-center text-center px-6">
          <p className="text-sm text-muted-foreground">
            Couldn&apos;t load recent jobs.
          </p>
          <p className="text-xs text-muted-foreground/70 mt-2 max-w-xs">
            The RPC node may be busy or temporarily unreachable.
          </p>
          <button
            type="button"
            onClick={refetch}
            className="mt-3 text-xs text-accent hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded"
          >
            Retry
          </button>
        </div>
      );
    }

    if (!jobs || jobs.length === 0) {
      return (
        <div className="py-12 flex flex-col items-center justify-center text-center px-6">
          <p className="text-sm text-muted-foreground">No jobs yet.</p>
          <p className="text-xs text-muted-foreground/70 mt-2 max-w-xs">
            Jobs will appear here as soon as the first one is funded on
            chain.
          </p>
        </div>
      );
    }

    return (
      <div className="space-y-3">
        {jobs.map((job: RecentJob, index: number) => {
          // None (status === 0) is filtered upstream — anything we see here
          // is one of the five real states. Cast tells TS the lookup is safe.
          const config =
            STATUS_CONFIG[job.status as Exclude<JobStatus, 0>] ??
            STATUS_CONFIG[JobStatus.Funded];
          const StatusIcon = config.icon;

          return (
            <div
              key={job.jobId.toString()}
              className="group flex items-center justify-between p-3 rounded-lg hover:bg-secondary/50 transition-all duration-200 animate-in fade-in slide-in-from-left-2"
              style={{
                animationDelay: `${(index + 3) * 100}ms`,
                animationFillMode: "both",
              }}
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-secondary flex items-center justify-center text-muted-foreground group-hover:bg-accent/10 group-hover:text-accent transition-all duration-200">
                  <Bot className="w-5 h-5" />
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground font-mono">
                    Job #{job.jobId.toString()}
                  </p>
                  <p className="text-xs text-muted-foreground font-mono">
                    Agent #{job.agentId.toString()}{" "}
                    <span className="font-sans">•</span>{" "}
                    {relativeTime(job.createdAtSeconds)}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <span className="text-sm font-semibold font-mono text-foreground">
                  {formatUsdc(job.bountyMicro)}{" "}
                  <span className="text-xs text-muted-foreground">USDC</span>
                </span>
                <div
                  className={cn(
                    "flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium",
                    config.bg,
                    config.color,
                  )}
                >
                  <StatusIcon className="w-3 h-3" />
                  {config.label}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="bg-card border border-border rounded-xl p-5 animate-in fade-in slide-in-from-bottom-4 duration-500 delay-200">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h3 className="text-base font-semibold text-foreground">
            Recent Jobs
          </h3>
          <p className="text-sm text-muted-foreground mt-0.5">
            Latest activity
          </p>
        </div>
        {/*
         * "View all" goes nowhere yet — we don't have a /jobs page. Rendered
         * as a static link with `aria-disabled` so it looks consistent with
         * the rest of the card but doesn't navigate. Wire up when /jobs ships.
         */}
        <span
          aria-disabled
          className="flex items-center gap-1 text-sm text-muted-foreground font-medium cursor-not-allowed select-none"
          title="Coming soon"
        >
          View all
          <ArrowUpRight className="w-4 h-4" />
        </span>
      </div>

      {renderBody()}
    </div>
  );
}
