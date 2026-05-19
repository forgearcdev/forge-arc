"use client";

/**
 * Jobs section — full list of every on-chain job, filterable by status,
 * with expandable detail rows.
 *
 * Read-only in this phase. Phase 5f will wire the "Post Job" button to
 * the real `createJob()` call against JobEscrow; for now it logs a
 * placeholder and is wrapped in `<RequiresWallet>` so disconnected users
 * get a "Connect wallet to post a job" tooltip + click-to-connect path.
 *
 * Data: re-uses `useRecentJobs()` with no `limit` to fetch every job.
 * That hook already aggregates job structs (from useJobStats) with
 * JobCreated event metadata (timestamp + tx hash), so this page makes
 * zero additional RPC calls beyond what the Overview dashboard already
 * triggers.
 *
 * Render branches (mutually exclusive):
 *   - loading: 5 skeleton rows
 *   - error: friendly summary + Retry, same pattern as RevenueChart
 *   - empty (totalJobs === 0): "No jobs yet — be the first" CTA
 *   - filtered-empty (filter has 0 results): "No jobs match this filter"
 *   - normal: the live table
 *
 * Sort: jobId DESC (newest first). Pagination is a TODO once we exceed
 * ~20 jobs — for now the page just scrolls.
 */

import { useState } from "react";
import { formatUnits } from "viem";
import { formatDistanceToNow } from "date-fns";
import {
  Bot,
  CheckCircle2,
  ChevronDown,
  Clock,
  ExternalLink,
  MoreVertical,
  Plus,
  Send,
  Wallet,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { CopyButton } from "@/components/ui/copy-button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { RequiresWallet } from "@/components/requires-wallet";
import { PostJobDialog } from "@/components/dashboard/post-job-dialog";
import {
  useRecentJobs,
  type RecentJob,
} from "@/hooks/use-recent-jobs";
import { JobStatus } from "@/hooks/use-job-stats";
import { arcTestnet } from "@/lib/chains";

const EXPLORER_URL = arcTestnet.blockExplorers?.default.url ?? "";

/* ─── Filter chip definitions ────────────────────────────────────────── */

type Filter = JobStatus | "all";

const FILTER_OPTIONS: Array<{ value: Filter; label: string }> = [
  { value: "all", label: "All" },
  { value: JobStatus.Funded, label: "Funded" },
  { value: JobStatus.Submitted, label: "Submitted" },
  { value: JobStatus.Completed, label: "Completed" },
  { value: JobStatus.Rejected, label: "Rejected" },
  { value: JobStatus.Expired, label: "Expired" },
];

/* ─── Status badge config (mirrors recent-deals.tsx) ─────────────────── */

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

/* ─── Helpers (duplicated rather than imported until a 4th caller) ───── */

function formatUsdc(microUnits: bigint): string {
  return Number(formatUnits(microUnits, 6)).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function relativeTime(seconds: number | null): string {
  if (seconds == null) return "—";
  return formatDistanceToNow(new Date(seconds * 1000), { addSuffix: true });
}

/** Render unix seconds as "May 18, 2026, 14:32 UTC" — UTC for chain-honesty. */
function absoluteTime(seconds: number | null): string {
  if (seconds == null) return "—";
  return new Date(seconds * 1000).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }) + " UTC";
}

function truncateAddress(addr: string, head = 6, tail = 4): string {
  if (addr.length <= head + tail + 2) return addr;
  return `${addr.slice(0, head + 2)}…${addr.slice(-tail)}`;
}

/* ─── Section root ───────────────────────────────────────────────────── */

export function PipelineSection() {
  const { jobs, isLoading, isError, refetch } = useRecentJobs();
  const [filter, setFilter] = useState<Filter>("all");

  // Phase 5g: controlled dialog state for Post Job. Same sibling-not-nested
  // pattern as the Register Agent flow — RequiresWallet wraps the trigger
  // button (so disconnected clicks open the connect modal), and the
  // PostJobDialog lives next to it as a controlled component.
  const [postJobOpen, setPostJobOpen] = useState(false);

  // null while loading; empty array when zero jobs exist (handled separately
  // from filtered-empty so we can show the "be the first" CTA only at the
  // very beginning).
  const totalJobs = jobs?.length ?? null;
  const filtered =
    jobs == null
      ? null
      : filter === "all"
        ? jobs
        : jobs.filter((j) => j.status === filter);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h2 className="text-xl font-semibold text-foreground">Jobs</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Every job on Forge, newest first.
          </p>
        </div>

        <RequiresWallet message="Connect wallet to post a job">
          <button
            type="button"
            onClick={() => setPostJobOpen(true)}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-accent text-accent-foreground hover:bg-accent/90 transition-colors text-sm font-medium"
          >
            <Plus className="w-4 h-4" />
            Post Job
          </button>
        </RequiresWallet>
      </div>

      {/* Dialog renders as a portal — DOM position doesn't matter. Mint
       *  button is a no-op placeholder in Phase 5g.2; Phase 5g.3 wires
       *  useWriteContract for USDC.approve + JobEscrow.createJob plus
       *  the allowance pre-flight inside the dialog component. */}
      <PostJobDialog open={postJobOpen} onOpenChange={setPostJobOpen} />

      {/* Filter chips + count */}
      <div className="flex items-center flex-wrap gap-2">
        {FILTER_OPTIONS.map((opt) => {
          const isActive = filter === opt.value;
          return (
            <button
              key={String(opt.value)}
              type="button"
              onClick={() => setFilter(opt.value)}
              className={cn(
                "px-3 py-1.5 rounded-full text-xs font-medium transition-colors",
                isActive
                  ? "bg-accent text-accent-foreground"
                  : "bg-secondary text-muted-foreground hover:text-foreground",
              )}
            >
              {opt.label}
            </button>
          );
        })}

        {/* Count badge — pinned to the right via flex-grow spacer */}
        <span className="flex-1" />
        <span className="text-xs font-mono text-muted-foreground">
          {filtered == null
            ? "…"
            : `${filtered.length} ${filtered.length === 1 ? "job" : "jobs"}`}
        </span>
      </div>

      {/* Table card */}
      <JobsTable
        filtered={filtered}
        totalJobs={totalJobs}
        isLoading={isLoading}
        isError={isError}
        onRetry={refetch}
      />

      {/* Pagination TODO: when totalJobs > 20, add page controls or
       *   infinite scroll. Until then the page just scrolls. */}
    </div>
  );
}

/* ─── Table body (loading / error / empty / rows) ────────────────────── */

interface JobsTableProps {
  filtered: RecentJob[] | null;
  totalJobs: number | null;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
}

function JobsTable({
  filtered,
  totalJobs,
  isLoading,
  isError,
  onRetry,
}: JobsTableProps) {
  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <HeaderRow />

      {/* Body branch logic */}
      {isLoading ? (
        <div>
          {Array.from({ length: 5 }, (_, i) => (
            <SkeletonRow key={i} />
          ))}
        </div>
      ) : isError ? (
        <ErrorState onRetry={onRetry} />
      ) : totalJobs === 0 ? (
        <EmptyState
          title="No jobs yet — be the first."
          subtitle="Once a job is funded on chain it'll appear here."
        />
      ) : filtered != null && filtered.length === 0 ? (
        <EmptyState
          title="No jobs match this filter."
          subtitle="Try a different status or clear the filter."
        />
      ) : (
        <div>
          {filtered?.map((job) => (
            <JobRow key={job.jobId.toString()} job={job} />
          ))}
        </div>
      )}
    </div>
  );
}

const GRID_CLASS =
  "grid grid-cols-[110px,90px,1fr,150px,160px,60px] gap-4 items-center";

function HeaderRow() {
  return (
    <div
      className={cn(
        GRID_CLASS,
        "px-4 py-3 border-b border-border bg-secondary/30 text-xs uppercase tracking-wide text-muted-foreground",
      )}
    >
      <span>Job ID</span>
      <span>Agent</span>
      <span className="text-right">Bounty</span>
      <span>Status</span>
      <span>Created</span>
      <span className="sr-only">Actions</span>
    </div>
  );
}

function SkeletonRow() {
  return (
    <div className={cn(GRID_CLASS, "px-4 py-3 border-b border-border")}>
      <Skeleton className="h-4 w-16 bg-secondary" />
      <Skeleton className="h-4 w-12 bg-secondary" />
      <Skeleton className="h-4 w-20 bg-secondary ml-auto" />
      <Skeleton className="h-6 w-24 rounded-md bg-secondary" />
      <Skeleton className="h-4 w-28 bg-secondary" />
      <Skeleton className="h-6 w-6 rounded bg-secondary" />
    </div>
  );
}

function EmptyState({
  title,
  subtitle,
}: {
  title: string;
  subtitle: string;
}) {
  return (
    <div className="py-16 flex flex-col items-center justify-center text-center px-6">
      <p className="text-sm text-muted-foreground">{title}</p>
      <p className="text-xs text-muted-foreground/70 mt-2 max-w-xs">
        {subtitle}
      </p>
    </div>
  );
}

function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="py-16 flex flex-col items-center justify-center text-center px-6">
      <p className="text-sm text-muted-foreground">
        Couldn&apos;t load jobs.
      </p>
      <p className="text-xs text-muted-foreground/70 mt-2 max-w-xs">
        The RPC node may be busy or temporarily unreachable.
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-3 text-xs text-accent hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded"
      >
        Retry
      </button>
    </div>
  );
}

/* ─── Individual row + expanded detail ───────────────────────────────── */

function JobRow({ job }: { job: RecentJob }) {
  const [expanded, setExpanded] = useState(false);

  // Status fallback: STATUS_CONFIG omits the `None` (0) state; if a job
  // somehow surfaces with status=0 (shouldn't, we filter upstream) we
  // render it as Funded styling to avoid a runtime undefined.
  const config =
    STATUS_CONFIG[job.status as Exclude<JobStatus, 0>] ??
    STATUS_CONFIG[JobStatus.Funded];
  const StatusIcon = config.icon;

  const txExplorerUrl =
    job.createdTxHash != null ? `${EXPLORER_URL}/tx/${job.createdTxHash}` : null;

  // Toggle on Enter/Space when the row has keyboard focus — mirrors what
  // a real <button> would do, since we use a <div role="button"> (a real
  // <button> with `display: contents` had click-routing issues on the
  // first activation in some Chromium builds).
  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setExpanded((prev) => !prev);
    }
  };

  return (
    <div className="border-b border-border last:border-b-0">
      {/*
       * The main row area toggles expansion on click. Role=button +
       * tabIndex=0 + onKeyDown make it keyboard-accessible. The Actions
       * cell is rendered as a grid sibling (NOT inside the row button)
       * so its dropdown click doesn't bubble up to the row toggle.
       */}
      <div
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        aria-label={`Toggle details for Job #${job.jobId.toString()}`}
        onClick={() => setExpanded((e) => !e)}
        onKeyDown={handleKey}
        className={cn(
          GRID_CLASS,
          "px-4 py-3 hover:bg-secondary/30 transition-colors cursor-pointer text-left focus:outline-none focus-visible:bg-secondary/50",
        )}
      >
        <span className="font-mono text-sm text-foreground flex items-center gap-1.5">
          <ChevronDown
            className={cn(
              "w-3.5 h-3.5 text-muted-foreground transition-transform",
              expanded && "rotate-180",
            )}
          />
          Job #{job.jobId.toString()}
        </span>
        <span className="font-mono text-sm text-muted-foreground flex items-center gap-1">
          <Bot className="w-3.5 h-3.5" />
          {job.agentId.toString()}
        </span>
        <span className="font-mono text-sm text-foreground text-right">
          {formatUsdc(job.bountyMicro)}{" "}
          <span className="text-xs text-muted-foreground">USDC</span>
        </span>
        <span>
          <span
            className={cn(
              "inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium",
              config.bg,
              config.color,
            )}
          >
            <StatusIcon className="w-3 h-3" />
            {config.label}
          </span>
        </span>
        <span className="text-xs text-muted-foreground">
          {relativeTime(job.createdAtSeconds)}
        </span>

        {/* Actions column — sibling grid cell, NOT nested in the row
         *  button. `stopPropagation` on the trigger keeps a dropdown
         *  click from also toggling the row. */}
        <div
          className="flex items-center justify-end"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label={`Actions for Job #${job.jobId.toString()}`}
                className="inline-flex items-center justify-center w-7 h-7 rounded text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                onClick={(e) => e.stopPropagation()}
              >
                <MoreVertical className="w-4 h-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem
                disabled={!txExplorerUrl}
                onSelect={() => {
                  if (txExplorerUrl) window.open(txExplorerUrl, "_blank");
                }}
              >
                <ExternalLink className="w-3.5 h-3.5 mr-2" />
                View on Arcscan
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => {
                  // Reuse the same clipboard write path the CopyButton uses.
                  if (typeof navigator !== "undefined" && navigator.clipboard) {
                    void navigator.clipboard.writeText(job.jobId.toString());
                  }
                }}
              >
                <Bot className="w-3.5 h-3.5 mr-2" />
                Copy Job ID
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Expanded detail panel — render in DOM only when open to keep the
       *  collapsed state cheap. No animation library; a simple in/out
       *  transition would be fine to add later. */}
      {expanded && <JobDetail job={job} txExplorerUrl={txExplorerUrl} />}
    </div>
  );
}

function JobDetail({
  job,
  txExplorerUrl,
}: {
  job: RecentJob;
  txExplorerUrl: string | null;
}) {
  return (
    <div className="bg-secondary/30 border-t border-border px-4 py-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-3">
        <DetailRow
          label="Client"
          value={
            <span className="inline-flex items-center gap-1">
              <code className="font-mono text-xs text-foreground">
                {truncateAddress(job.client, 8, 6)}
              </code>
              <CopyButton value={job.client} label="Copy client address" />
              <a
                href={`${EXPLORER_URL}/address/${job.client}`}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="View client on Arcscan"
                className="inline-flex items-center justify-center rounded p-1 text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
              >
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </span>
          }
        />
        <DetailRow
          label="Agent ID"
          value={
            <span className="inline-flex items-center gap-1">
              <code className="font-mono text-xs text-foreground">
                #{job.agentId.toString()}
              </code>
              <CopyButton
                value={job.agentId.toString()}
                label="Copy agent id"
              />
            </span>
          }
        />
        <DetailRow
          label="Created"
          value={
            <span className="text-xs text-foreground">
              {absoluteTime(job.createdAtSeconds)}
              <span className="text-muted-foreground ml-2">
                ({relativeTime(job.createdAtSeconds)})
              </span>
            </span>
          }
        />
        <DetailRow
          label="Deadline"
          value={
            <span className="text-xs text-foreground">
              {absoluteTime(Number(job.expiredAt))}
              <span className="text-muted-foreground ml-2">
                ({relativeTime(Number(job.expiredAt))})
              </span>
            </span>
          }
        />
        <DetailRow
          label="Deliverable URI"
          value={
            <code className="font-mono text-xs text-foreground break-all">
              {job.deliverableURI || "—"}
            </code>
          }
          fullWidth
        />
        <DetailRow
          label="Tx Hash"
          value={
            job.createdTxHash ? (
              <span className="inline-flex items-center gap-1">
                <code
                  className="font-mono text-xs text-foreground"
                  title={job.createdTxHash}
                >
                  {truncateAddress(job.createdTxHash, 8, 6)}
                </code>
                <CopyButton
                  value={job.createdTxHash}
                  label="Copy transaction hash"
                />
                {txExplorerUrl && (
                  <a
                    href={txExplorerUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label="View transaction on Arcscan"
                    className="inline-flex items-center justify-center rounded p-1 text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                )}
              </span>
            ) : (
              <span className="text-xs text-muted-foreground">—</span>
            )
          }
          fullWidth
        />
      </div>
    </div>
  );
}

function DetailRow({
  label,
  value,
  fullWidth,
}: {
  label: string;
  value: React.ReactNode;
  fullWidth?: boolean;
}) {
  return (
    <div className={cn("flex flex-col gap-1", fullWidth && "md:col-span-2")}>
      <span className="text-xs text-muted-foreground uppercase tracking-wide">
        {label}
      </span>
      {value}
    </div>
  );
}
