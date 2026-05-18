"use client";

/**
 * Agents section — registered ERC-8004 agent NFTs with their on-chain
 * activity aggregated from JobEscrow + ReputationRegistry.
 *
 * Read-only in this phase. Phase 5e will wire "Register Agent" to a real
 * mint flow against the IdentityRegistry; the button currently just logs
 * a placeholder and is gated behind RequiresWallet.
 *
 * Data: `useAgents()` derives one row per unique agentId observed in
 * JobEscrow. Owner addresses are pulled via batched ownerOf reads against
 * the IdentityRegistry; reputation counts come from batched getLastIndex
 * reads against the ReputationRegistry. Net new RPC trips per page load:
 * one batched ownerOf + one batched getLastIndex. Everything else
 * piggybacks on the same reads the Overview already triggers.
 *
 * Render branches:
 *   - loading: 5 skeleton rows
 *   - error: friendly summary + Retry
 *   - empty (totalAgents === 0): "No agents yet — be the first to register"
 *   - normal: live table
 *
 * Sort: USDC earned DESC (top earners first). No status filter — we'll
 * add one when the agent count grows past ~20 (current count: 2).
 */

import { useState } from "react";
import { formatUnits } from "viem";
import { formatDistanceToNow } from "date-fns";
import {
  Bot,
  Briefcase,
  ChevronDown,
  Coins,
  ExternalLink,
  MoreVertical,
  Plus,
  Star,
  User,
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
import { useAgents, type Agent } from "@/hooks/use-agents";
import { CONTRACT_ADDRESSES } from "@/lib/contracts";
import { arcTestnet } from "@/lib/chains";

const EXPLORER_URL = arcTestnet.blockExplorers?.default.url ?? "";

/* ─── Shared helpers (mirror pipeline.tsx until extracted) ───────────── */

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

/* ─── Section root ───────────────────────────────────────────────────── */

export function CustomersSection() {
  const { agents, isLoading, isError, refetch } = useAgents();
  const count = agents?.length ?? null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h2 className="text-xl font-semibold text-foreground">Agents</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Registered agents on Arc testnet, sorted by earnings.
          </p>
        </div>

        <RequiresWallet message="Connect wallet to register an agent">
          <button
            type="button"
            onClick={() => {
              // Phase 5e will swap this for a real IdentityRegistry mint
              // flow. Keep this discoverable in console so it's obvious
              // the wiring is pending.
              // eslint-disable-next-line no-console
              console.log("Phase 5e placeholder — Register Agent clicked");
            }}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-accent text-accent-foreground hover:bg-accent/90 transition-colors text-sm font-medium"
          >
            <Plus className="w-4 h-4" />
            Register Agent
          </button>
        </RequiresWallet>
      </div>

      {/* Count badge */}
      {/* Filter to be added when agent count grows (e.g. by "Has earnings"
       *  vs "No completions yet"). Skipped now — with 2 agents a filter
       *  would be noise. */}
      <div className="flex items-center gap-2">
        <span className="flex-1" />
        <span className="text-xs font-mono text-muted-foreground">
          {count == null
            ? "…"
            : `${count} ${count === 1 ? "agent" : "agents"}`}
        </span>
      </div>

      {/* Table card */}
      <AgentsTable
        agents={agents}
        isLoading={isLoading}
        isError={isError}
        onRetry={refetch}
      />
    </div>
  );
}

/* ─── Table body branches ────────────────────────────────────────────── */

interface AgentsTableProps {
  agents: Agent[] | null;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
}

function AgentsTable({
  agents,
  isLoading,
  isError,
  onRetry,
}: AgentsTableProps) {
  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <HeaderRow />

      {isLoading ? (
        <div>
          {Array.from({ length: 5 }, (_, i) => (
            <SkeletonRow key={i} />
          ))}
        </div>
      ) : isError ? (
        <ErrorState onRetry={onRetry} />
      ) : !agents || agents.length === 0 ? (
        <EmptyState />
      ) : (
        <div>
          {agents.map((a) => (
            <AgentRow key={a.agentId.toString()} agent={a} />
          ))}
        </div>
      )}
    </div>
  );
}

const GRID_CLASS =
  "grid grid-cols-[110px,150px,110px,130px,110px,1fr,60px] gap-4 items-center";

function HeaderRow() {
  return (
    <div
      className={cn(
        GRID_CLASS,
        "px-4 py-3 border-b border-border bg-secondary/30 text-xs uppercase tracking-wide text-muted-foreground",
      )}
    >
      <span>Agent ID</span>
      <span>Owner</span>
      <span className="text-right">Jobs Done</span>
      <span className="text-right">USDC Earned</span>
      <span className="text-right">Reputation</span>
      <span>Last Active</span>
      <span className="sr-only">Actions</span>
    </div>
  );
}

function SkeletonRow() {
  return (
    <div className={cn(GRID_CLASS, "px-4 py-3 border-b border-border")}>
      <Skeleton className="h-4 w-20 bg-secondary" />
      <Skeleton className="h-4 w-28 bg-secondary" />
      <Skeleton className="h-4 w-8 bg-secondary ml-auto" />
      <Skeleton className="h-4 w-20 bg-secondary ml-auto" />
      <Skeleton className="h-4 w-8 bg-secondary ml-auto" />
      <Skeleton className="h-4 w-32 bg-secondary" />
      <Skeleton className="h-6 w-6 rounded bg-secondary" />
    </div>
  );
}

function EmptyState() {
  return (
    <div className="py-16 flex flex-col items-center justify-center text-center px-6">
      <p className="text-sm text-muted-foreground">
        No agents yet — be the first to register.
      </p>
      <p className="text-xs text-muted-foreground/70 mt-2 max-w-xs">
        Agents are ERC-8004 NFTs minted via the IdentityRegistry. Once
        registered, they show up here with on-chain activity stats.
      </p>
    </div>
  );
}

function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="py-16 flex flex-col items-center justify-center text-center px-6">
      <p className="text-sm text-muted-foreground">
        Couldn&apos;t load agents.
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

function AgentRow({ agent }: { agent: Agent }) {
  const [expanded, setExpanded] = useState(false);

  // Mirror the keyboard a11y pattern from pipeline.tsx — using
  // `<div role="button">` (not a `<button>` with display:contents) because
  // that caused click-routing flakiness in Chromium during 5b. See
  // pipeline.tsx commit history for the gotcha.
  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setExpanded((prev) => !prev);
    }
  };

  // Arcscan deep-link for the NFT token page. IdentityRegistry is an
  // ERC-721, so Arcscan exposes tokens via /token/<address>?a=<id>.
  const tokenExplorerUrl = `${EXPLORER_URL}/token/${CONTRACT_ADDRESSES.identityRegistry}?a=${agent.agentId.toString()}`;
  const ownerExplorerUrl =
    agent.owner != null ? `${EXPLORER_URL}/address/${agent.owner}` : null;

  return (
    <div className="border-b border-border last:border-b-0">
      <div
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        aria-label={`Toggle details for Agent #${agent.agentId.toString()}`}
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
          #{agent.agentId.toString()}
        </span>
        <span className="font-mono text-xs text-muted-foreground">
          {agent.owner != null ? truncateAddress(agent.owner) : "—"}
        </span>
        <span className="font-mono text-sm text-foreground text-right">
          {agent.jobsCompleted}
          {agent.totalJobs > agent.jobsCompleted && (
            <span className="text-xs text-muted-foreground">
              /{agent.totalJobs}
            </span>
          )}
        </span>
        <span className="font-mono text-sm text-foreground text-right">
          {formatUsdc(agent.usdcEarnedMicro)}{" "}
          <span className="text-xs text-muted-foreground">USDC</span>
        </span>
        <span className="font-mono text-sm text-foreground text-right flex items-center justify-end gap-1">
          <Star
            className={cn(
              "w-3.5 h-3.5",
              agent.reputationCount > 0
                ? "text-accent fill-accent"
                : "text-muted-foreground",
            )}
          />
          {agent.reputationCount}
        </span>
        <span className="text-xs text-muted-foreground">
          {relativeTime(agent.lastJobAt)}
        </span>

        {/* Actions cell — sibling grid cell so dropdown clicks don't bubble. */}
        <div
          className="flex items-center justify-end"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label={`Actions for Agent #${agent.agentId.toString()}`}
                className="inline-flex items-center justify-center w-7 h-7 rounded text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                onClick={(e) => e.stopPropagation()}
              >
                <MoreVertical className="w-4 h-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuItem
                onSelect={() => {
                  window.open(tokenExplorerUrl, "_blank");
                }}
              >
                <ExternalLink className="w-3.5 h-3.5 mr-2" />
                View on Arcscan
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => {
                  if (typeof navigator !== "undefined" && navigator.clipboard) {
                    void navigator.clipboard.writeText(agent.agentId.toString());
                  }
                }}
              >
                <Bot className="w-3.5 h-3.5 mr-2" />
                Copy Agent ID
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={agent.owner == null}
                onSelect={() => {
                  if (
                    agent.owner != null &&
                    typeof navigator !== "undefined" &&
                    navigator.clipboard
                  ) {
                    void navigator.clipboard.writeText(agent.owner);
                  }
                }}
              >
                <User className="w-3.5 h-3.5 mr-2" />
                Copy Owner Address
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {expanded && (
        <AgentDetail
          agent={agent}
          tokenExplorerUrl={tokenExplorerUrl}
          ownerExplorerUrl={ownerExplorerUrl}
        />
      )}
    </div>
  );
}

function AgentDetail({
  agent,
  tokenExplorerUrl,
  ownerExplorerUrl,
}: {
  agent: Agent;
  tokenExplorerUrl: string;
  ownerExplorerUrl: string | null;
}) {
  return (
    <div className="bg-secondary/30 border-t border-border px-4 py-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-3">
        <DetailRow
          label="Owner Address"
          value={
            agent.owner != null ? (
              <span className="inline-flex items-center gap-1">
                <code
                  className="font-mono text-xs text-foreground"
                  title={agent.owner}
                >
                  {truncateAddress(agent.owner, 8, 6)}
                </code>
                <CopyButton value={agent.owner} label="Copy owner address" />
                {ownerExplorerUrl && (
                  <a
                    href={ownerExplorerUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label="View owner on Arcscan"
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
        />
        <DetailRow
          label="NFT Token Page"
          value={
            <a
              href={tokenExplorerUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-accent hover:underline"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              View on Arcscan
            </a>
          }
        />
        <DetailRow
          label="Earnings"
          value={
            <span className="text-xs text-foreground inline-flex items-center gap-2">
              <Coins className="w-3.5 h-3.5 text-muted-foreground" />
              <span className="font-mono">
                {formatUsdc(agent.usdcEarnedMicro)} USDC
              </span>
              <span className="text-muted-foreground">
                from {agent.jobsCompleted}{" "}
                {agent.jobsCompleted === 1 ? "completed job" : "completed jobs"}
                {agent.totalJobs > agent.jobsCompleted &&
                  ` (${agent.totalJobs} total assigned)`}
              </span>
            </span>
          }
        />
        <DetailRow
          label="Reputation"
          value={
            <span className="text-xs text-foreground inline-flex items-center gap-2">
              <Star
                className={cn(
                  "w-3.5 h-3.5",
                  agent.reputationCount > 0
                    ? "text-accent fill-accent"
                    : "text-muted-foreground",
                )}
              />
              {agent.reputationCount === 0 ? (
                <span className="text-muted-foreground">
                  No feedback yet
                </span>
              ) : (
                <span>
                  {agent.reputationCount}{" "}
                  {agent.reputationCount === 1 ? "entry" : "entries"} from
                  client feedback
                </span>
              )}
            </span>
          }
        />
        <DetailRow
          label="Last Active"
          value={
            <span className="text-xs text-foreground">
              {absoluteTime(agent.lastJobAt)}
              <span className="text-muted-foreground ml-2">
                ({relativeTime(agent.lastJobAt)})
              </span>
            </span>
          }
          fullWidth
        />
        <DetailRow
          label="Jobs"
          value={
            agent.jobIds.length > 0 ? (
              <span className="text-xs text-foreground inline-flex items-center gap-2 flex-wrap">
                <Briefcase className="w-3.5 h-3.5 text-muted-foreground" />
                {agent.jobIds.map((jobId, i) => (
                  <span
                    key={jobId.toString()}
                    className="font-mono text-foreground"
                  >
                    {/*
                     * No deep-link to a filtered Jobs page yet — the Jobs
                     * section doesn't take a URL param. When it does, this
                     * becomes an anchor to /?section=jobs&agentId=N.
                     */}
                    Job #{jobId.toString()}
                    {i < agent.jobIds.length - 1 && (
                      <span className="text-muted-foreground">,</span>
                    )}
                  </span>
                ))}
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
