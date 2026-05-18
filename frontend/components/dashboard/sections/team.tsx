"use client";

/**
 * My Activity section — the connected wallet's view of Forge.
 *
 * Replaces the v0 salesops "team performance / quotas / weekly chart"
 * mock with two real perspectives derived from on-chain reads:
 *
 *   - As Client — jobs you posted (you funded the bounty)
 *   - As Agent  — jobs assigned to an agent NFT you currently own
 *
 * The same wallet can be on both sides of the same job (and is, in our
 * smoke test). Two tabs let the user switch perspective; the default
 * picks whichever side has more activity.
 *
 * Render branches:
 *   - disconnected: connect-wallet empty state with RainbowKit modal trigger
 *   - loading: skeleton stat cards + table skeleton
 *   - error: friendly summary + Retry
 *   - empty-on-tab: per-tab empty state (you haven't posted / haven't been
 *     hired yet) with a CTA pointing at the relevant Post Job / Register
 *     Agent button — Phase 5e/5f will wire those up properly
 *   - normal: two stat cards + tabs + filtered table
 *
 * The job table is intentionally identical in look to `pipeline.tsx`'s
 * table; we re-implement it inline (rather than extracting) because the
 * cell content differs slightly per perspective and a generic abstraction
 * would obscure more than it would save. Revisit if a third caller shows up.
 */

import { useMemo, useState } from "react";
import { formatUnits } from "viem";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { formatDistanceToNow } from "date-fns";
import {
  Bot,
  Briefcase,
  CheckCircle2,
  ChevronDown,
  Clock,
  Coins,
  ExternalLink,
  MoreVertical,
  Send,
  Star,
  TrendingUp,
  User,
  Wallet,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { CopyButton } from "@/components/ui/copy-button";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useMyActivity } from "@/hooks/use-my-activity";
import { type RecentJob } from "@/hooks/use-recent-jobs";
import { JobStatus } from "@/hooks/use-job-stats";
import { arcTestnet } from "@/lib/chains";

const EXPLORER_URL = arcTestnet.blockExplorers?.default.url ?? "";

/* ─── Shared helpers (mirrors pipeline.tsx / customers.tsx) ──────────── */

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

function absoluteTime(seconds: number | null): string {
  if (seconds == null) return "—";
  return (
    new Date(seconds * 1000).toLocaleString("en-US", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "UTC",
    }) + " UTC"
  );
}

function truncateAddress(addr: string, head = 6, tail = 4): string {
  if (addr.length <= head + tail + 2) return addr;
  return `${addr.slice(0, head + 2)}…${addr.slice(-tail)}`;
}

/* ─── Status badge config (mirrors pipeline.tsx) ─────────────────────── */

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

/* ─── Section root ───────────────────────────────────────────────────── */

export function TeamSection() {
  const { data, address, isConnected, isLoading, isError, refetch } =
    useMyActivity();

  // ── Disconnected: short-circuit to a connect CTA ────────────────────
  if (!isConnected) {
    return <DisconnectedState />;
  }

  // ── Loading: skeleton everything ────────────────────────────────────
  if (isLoading || !data) {
    return <LoadingState />;
  }

  // ── Error: shared retry pattern ─────────────────────────────────────
  if (isError) {
    return <ErrorState onRetry={refetch} />;
  }

  return (
    <ActivityView data={data} address={address!} />
  );
}

/* ─── Subviews ───────────────────────────────────────────────────────── */

function DisconnectedState() {
  const { openConnectModal } = useConnectModal();
  return (
    <div className="space-y-6">
      <Header />
      <div className="bg-card border border-border rounded-xl p-12 flex flex-col items-center justify-center text-center">
        <div className="w-12 h-12 rounded-lg bg-secondary flex items-center justify-center mb-4">
          <Wallet className="w-6 h-6 text-muted-foreground" />
        </div>
        <h3 className="text-base font-semibold text-foreground">
          Connect your wallet
        </h3>
        <p className="text-sm text-muted-foreground mt-1 max-w-sm">
          My Activity shows the jobs you&apos;ve posted as a client and the
          jobs your agents have taken on. Connect a wallet to see yours.
        </p>
        <button
          type="button"
          onClick={openConnectModal}
          className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-accent text-accent-foreground hover:bg-accent/90 transition-colors text-sm font-medium"
        >
          <Wallet className="w-4 h-4" />
          Connect Wallet
        </button>
      </div>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="space-y-6">
      <Header />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Skeleton className="h-32 rounded-xl bg-secondary" />
        <Skeleton className="h-32 rounded-xl bg-secondary" />
      </div>
      <Skeleton className="h-10 w-64 rounded-lg bg-secondary" />
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <Skeleton className="h-12 w-full bg-secondary" />
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-14 w-full bg-secondary/50" />
        ))}
      </div>
    </div>
  );
}

function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="space-y-6">
      <Header />
      <div className="bg-card border border-border rounded-xl py-16 flex flex-col items-center justify-center text-center px-6">
        <p className="text-sm text-muted-foreground">
          Couldn&apos;t load your activity.
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
    </div>
  );
}

function Header() {
  return (
    <div>
      <h2 className="text-xl font-semibold text-foreground">My Activity</h2>
      <p className="text-sm text-muted-foreground mt-1">
        On-chain activity for the connected wallet.
      </p>
    </div>
  );
}

/* ─── Main connected view: stats + tabs + tables ─────────────────────── */

function ActivityView({
  data,
  address,
}: {
  data: NonNullable<ReturnType<typeof useMyActivity>["data"]>;
  address: `0x${string}`;
}) {
  // Pick the default tab based on which side has more activity. Ties go to
  // "client" because Post Job is the more common entry point in the demo —
  // a fresh wallet has neither, so this just biases the empty state.
  const defaultTab = useMemo<"client" | "agent">(
    () =>
      data.asAgent.taken > data.asClient.posted ? "agent" : "client",
    [data.asAgent.taken, data.asClient.posted],
  );

  return (
    <div className="space-y-6">
      {/* Header with wallet badge */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <Header />
        <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-secondary text-xs">
          <Wallet className="w-3.5 h-3.5 text-muted-foreground" />
          <code className="font-mono text-foreground">
            {truncateAddress(address, 8, 6)}
          </code>
          <CopyButton value={address} label="Copy wallet address" />
        </span>
      </div>

      {/* Two summary cards — one per perspective */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <ClientSummaryCard stats={data.asClient} />
        <AgentSummaryCard stats={data.asAgent} />
      </div>

      {/* Tabs */}
      <Tabs defaultValue={defaultTab} className="space-y-4">
        <TabsList>
          <TabsTrigger value="client" className="px-4">
            <User className="w-3.5 h-3.5" />
            As Client
            <span className="ml-1 text-xs text-muted-foreground font-mono">
              {data.asClient.posted}
            </span>
          </TabsTrigger>
          <TabsTrigger value="agent" className="px-4">
            <Bot className="w-3.5 h-3.5" />
            As Agent
            <span className="ml-1 text-xs text-muted-foreground font-mono">
              {data.asAgent.taken}
            </span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="client">
          <ActivityTable
            jobs={data.asClient.jobs}
            perspective="client"
            emptyState={
              <ClientEmptyState />
            }
          />
        </TabsContent>

        <TabsContent value="agent">
          <ActivityTable
            jobs={data.asAgent.jobs}
            perspective="agent"
            emptyState={
              <AgentEmptyState
                ownedAgentIds={data.asAgent.ownedAgentIds}
              />
            }
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/* ─── Summary cards ──────────────────────────────────────────────────── */

function ClientSummaryCard({
  stats,
}: {
  stats: NonNullable<ReturnType<typeof useMyActivity>["data"]>["asClient"];
}) {
  return (
    <div className="bg-card border border-border rounded-xl p-5">
      <div className="flex items-center gap-2 mb-4">
        <div className="w-8 h-8 rounded-lg bg-accent/10 flex items-center justify-center">
          <User className="w-4 h-4 text-accent" />
        </div>
        <h3 className="text-sm font-semibold text-foreground">As Client</h3>
      </div>
      <div className="grid grid-cols-3 gap-4">
        <StatTile
          icon={Briefcase}
          label="Posted"
          value={stats.posted.toString()}
        />
        <StatTile
          icon={Coins}
          label="Spent"
          value={
            <>
              {formatUsdc(stats.spentMicro)}{" "}
              <span className="text-xs text-muted-foreground font-normal">
                USDC
              </span>
            </>
          }
        />
        <StatTile
          icon={CheckCircle2}
          label="Success rate"
          value={
            stats.successRatePercent == null
              ? "—"
              : `${stats.successRatePercent}%`
          }
        />
      </div>
    </div>
  );
}

function AgentSummaryCard({
  stats,
}: {
  stats: NonNullable<ReturnType<typeof useMyActivity>["data"]>["asAgent"];
}) {
  return (
    <div className="bg-card border border-border rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-success/10 flex items-center justify-center">
            <Bot className="w-4 h-4 text-success" />
          </div>
          <h3 className="text-sm font-semibold text-foreground">As Agent</h3>
        </div>
        {stats.ownedAgentIds.length > 0 && (
          <span className="text-xs text-muted-foreground font-mono">
            owns {stats.ownedAgentIds.length}{" "}
            {stats.ownedAgentIds.length === 1 ? "agent" : "agents"}
          </span>
        )}
      </div>
      <div className="grid grid-cols-3 gap-4">
        <StatTile
          icon={Briefcase}
          label="Completed"
          value={`${stats.completed}/${stats.taken}`}
        />
        <StatTile
          icon={TrendingUp}
          label="Earned"
          value={
            <>
              {formatUsdc(stats.earnedMicro)}{" "}
              <span className="text-xs text-muted-foreground font-normal">
                USDC
              </span>
            </>
          }
        />
        <StatTile
          icon={Star}
          label="Reputation"
          value={stats.reputationCount.toString()}
        />
      </div>
    </div>
  );
}

function StatTile({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Briefcase;
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon className="w-3 h-3" />
        {label}
      </div>
      <p className="mt-1 text-lg font-semibold font-mono text-foreground">
        {value}
      </p>
    </div>
  );
}

/* ─── Activity table (per tab) ───────────────────────────────────────── */

const GRID_CLASS =
  "grid grid-cols-[110px,90px,1fr,150px,160px,60px] gap-4 items-center";

function ActivityTable({
  jobs,
  perspective,
  emptyState,
}: {
  jobs: RecentJob[];
  perspective: "client" | "agent";
  emptyState: React.ReactNode;
}) {
  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <HeaderRow />
      {jobs.length === 0 ? (
        emptyState
      ) : (
        <div>
          {jobs.map((job) => (
            <JobRow
              key={job.jobId.toString()}
              job={job}
              perspective={perspective}
            />
          ))}
        </div>
      )}
    </div>
  );
}

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

function ClientEmptyState() {
  return (
    <div className="py-16 flex flex-col items-center justify-center text-center px-6">
      <p className="text-sm text-muted-foreground">
        You haven&apos;t posted any jobs yet.
      </p>
      <p className="text-xs text-muted-foreground/70 mt-2 max-w-xs">
        Once you post your first job from the Jobs page it&apos;ll show up
        here.
      </p>
    </div>
  );
}

function AgentEmptyState({
  ownedAgentIds,
}: {
  ownedAgentIds: bigint[];
}) {
  // Two distinct empty subcases:
  //   - "no agents at all": you haven't registered yet
  //   - "have agents, no jobs yet": you own NFTs but nobody has hired them
  if (ownedAgentIds.length === 0) {
    return (
      <div className="py-16 flex flex-col items-center justify-center text-center px-6">
        <p className="text-sm text-muted-foreground">
          You don&apos;t own any agent NFTs yet.
        </p>
        <p className="text-xs text-muted-foreground/70 mt-2 max-w-xs">
          Register an agent on the Agents page to make it discoverable for
          clients to hire.
        </p>
      </div>
    );
  }
  return (
    <div className="py-16 flex flex-col items-center justify-center text-center px-6">
      <p className="text-sm text-muted-foreground">
        Your agent{ownedAgentIds.length === 1 ? "" : "s"} ha
        {ownedAgentIds.length === 1 ? "sn't" : "ven't"} been hired yet.
      </p>
      <p className="text-xs text-muted-foreground/70 mt-2 max-w-sm">
        You own{" "}
        <span className="font-mono">
          {ownedAgentIds
            .map((id) => `#${id.toString()}`)
            .join(", ")}
        </span>
        . When a client funds a job for one of these agents, it&apos;ll
        show up here.
      </p>
    </div>
  );
}

/* ─── Row + expanded detail (modeled on pipeline.tsx JobRow) ─────────── */

function JobRow({
  job,
  perspective,
}: {
  job: RecentJob;
  perspective: "client" | "agent";
}) {
  const [expanded, setExpanded] = useState(false);

  const config =
    STATUS_CONFIG[job.status as Exclude<JobStatus, 0>] ??
    STATUS_CONFIG[JobStatus.Funded];
  const StatusIcon = config.icon;

  const txExplorerUrl =
    job.createdTxHash != null ? `${EXPLORER_URL}/tx/${job.createdTxHash}` : null;

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setExpanded((prev) => !prev);
    }
  };

  return (
    <div className="border-b border-border last:border-b-0">
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
          {/* Signed bounty: agent perspective shows +N for completed,
              client perspective shows -N for completed (money out).
              All non-terminal states (and refunded) render unsigned. */}
          <SignedBounty job={job} perspective={perspective} />
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

      {expanded && <JobDetail job={job} txExplorerUrl={txExplorerUrl} />}
    </div>
  );
}

/**
 * Render bounty with a +/-/(none) sign depending on perspective.
 *
 *   - Client + Completed   → -N (money out of your wallet)
 *   - Agent  + Completed   → +N (money into your wallet)
 *   - Anything else        → bare N (no flow yet; escrow either still
 *                            holds it or refunded back to client)
 */
function SignedBounty({
  job,
  perspective,
}: {
  job: RecentJob;
  perspective: "client" | "agent";
}) {
  const formatted = formatUsdc(job.bountyMicro);
  if (job.status !== JobStatus.Completed) {
    return (
      <>
        {formatted}{" "}
        <span className="text-xs text-muted-foreground">USDC</span>
      </>
    );
  }
  const isPositive = perspective === "agent";
  return (
    <span className={isPositive ? "text-success" : "text-destructive"}>
      {isPositive ? "+" : "-"}
      {formatted}{" "}
      <span className="text-xs text-muted-foreground">USDC</span>
    </span>
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
