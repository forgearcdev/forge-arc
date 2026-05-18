"use client";

/**
 * Settings — read-only network + contract + wallet info.
 *
 * Replaces the v0 salesops settings page (API keys, billing, team invites,
 * notifications) with what's actually useful for a wallet-driven dapp:
 * the chain we're talking to, the contracts we read/write, and the
 * connected wallet's state. No persisted preferences — the chain is
 * pinned to Arc Testnet in `lib/chains.ts`, so there's nothing to
 * configure here yet.
 *
 * Four cards:
 *   1. Network          — chain status, chain id, RPC URL, explorer link
 *   2. Contract Addresses — JobEscrow, USDC, ERC-8004 registries
 *   3. Wallet           — only rendered when connected (address, USDC
 *                          balance, chain match)
 *   4. About            — one-liner, version, source link
 *
 * Everything technical is mono-font and copy-button-adjacent. Block
 * explorer links open in a new tab.
 */

import { useEffect, useState } from "react";
import { useAccount, useBalance, useChainId, useSwitchChain } from "wagmi";
import { formatUnits } from "viem";
import {
  Activity,
  Coins,
  ExternalLink,
  FileCode2,
  Github,
  Globe,
  Info,
  Network,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CopyButton } from "@/components/ui/copy-button";
import { arcTestnet } from "@/lib/chains";
import { CHAIN_ID, CONTRACT_ADDRESSES } from "@/lib/contracts";

/**
 * Hardcoded version string. The frontend package.json is still at `0.0.0`
 * (v0 scaffold default) — bumping it across the codebase is out of scope
 * for Phase 5a. Update both sides together in a future release commit.
 */
const FRONTEND_VERSION = "v0.1.0";

const GITHUB_URL = "https://github.com/forgearcdev/forge-arc";

const RPC_URL = arcTestnet.rpcUrls.default.http[0];
const EXPLORER_URL = arcTestnet.blockExplorers?.default.url ?? "";

/**
 * Truncate `0x1234567890abcdef…` to `0x123456…cdef` for display in narrow
 * columns. Keeps enough head/tail bytes for at-a-glance identification.
 * Falls through unchanged for strings that aren't long enough to truncate.
 */
function truncateAddress(addr: string, head = 6, tail = 4): string {
  if (addr.length <= head + tail + 2) return addr;
  return `${addr.slice(0, head + 2)}…${addr.slice(-tail)}`;
}

/** Convenience: build an Arcscan address page URL. */
function explorerAddressUrl(address: string): string {
  return `${EXPLORER_URL}/address/${address}`;
}

/**
 * Same `formatUsdc` we use in overview.tsx / pipeline-overview.tsx /
 * recent-deals.tsx. Keeping it inline (rather than extracting a shared
 * util) until the fourth caller, then we promote.
 */
function formatUsdc(microUnits: bigint): string {
  return Number(formatUnits(microUnits, 6)).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Ordered list driving the Contract Addresses card. Pulled from
 * `CONTRACT_ADDRESSES` so this stays a single source of truth — the only
 * thing this file adds is a human-readable label per entry.
 *
 * Order matters: JobEscrow first (it's our contract, most relevant),
 * then USDC (the asset), then the ERC-8004 registries (external standard).
 */
const CONTRACT_ROWS: Array<{
  label: string;
  description: string;
  address: `0x${string}`;
}> = [
  {
    label: "JobEscrow",
    description: "Forge's escrow + payout contract",
    address: CONTRACT_ADDRESSES.jobEscrow,
  },
  {
    label: "USDC",
    description: "Native gas + bounty asset on Arc",
    address: CONTRACT_ADDRESSES.usdc,
  },
  {
    label: "IdentityRegistry",
    description: "ERC-8004 agent identity NFT",
    address: CONTRACT_ADDRESSES.identityRegistry,
  },
  {
    label: "ReputationRegistry",
    description: "ERC-8004 client feedback log",
    address: CONTRACT_ADDRESSES.reputationRegistry,
  },
  {
    label: "ValidationRegistry",
    description: "ERC-8004 third-party validation",
    address: CONTRACT_ADDRESSES.validationRegistry,
  },
];

export function SettingsSection() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-foreground">Settings</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Network info, deployed contracts, and connected-wallet status.
        </p>
      </div>

      <NetworkCard />
      <ContractsCard />
      <WalletCard />
      <AboutCard />
    </div>
  );
}

/* ─── Network card ───────────────────────────────────────────────────── */

function NetworkCard() {
  return (
    <Card className="border-border bg-card">
      <CardHeader>
        <CardTitle className="text-base font-medium flex items-center gap-2">
          <Network className="w-4 h-4 text-muted-foreground" />
          Network
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <NetworkStatusRow />

        <KeyValueRow label="Chain ID" value={CHAIN_ID.toString()} copyable />
        <KeyValueRow
          label="RPC URL"
          value={RPC_URL}
          copyable
          // RPC URL is long enough on mobile that we want it to wrap; let
          // the cell breathe rather than truncating.
        />
        <KeyValueRow
          label="Block Explorer"
          // Strip protocol for a cleaner display — the link itself still
          // points at the full URL.
          value={EXPLORER_URL.replace(/^https?:\/\//, "")}
          link={EXPLORER_URL}
        />
      </CardContent>
    </Card>
  );
}

/**
 * Three-state pill identical in semantics to the header NetworkIndicator
 * but laid out as a labelled row inside the Settings card.
 */
function NetworkStatusRow() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const { isConnected } = useAccount();
  const chainId = useChainId();
  const { switchChain } = useSwitchChain();

  const onArc = chainId === arcTestnet.id;

  let dot: React.ReactNode;
  let label: string;
  let labelClass = "text-muted-foreground";
  let action: React.ReactNode = null;

  if (!mounted || !isConnected) {
    dot = <span className="w-2 h-2 rounded-full bg-muted-foreground/60" />;
    label = "Wallet not connected";
  } else if (onArc) {
    dot = <span className="w-2 h-2 rounded-full bg-success animate-pulse" />;
    label = `Connected — ${arcTestnet.name}`;
    labelClass = "text-success";
  } else {
    dot = (
      <span className="w-2 h-2 rounded-full bg-destructive animate-pulse" />
    );
    label = `Wrong chain (id ${chainId})`;
    labelClass = "text-destructive";
    action = (
      <button
        type="button"
        onClick={() => switchChain({ chainId: arcTestnet.id })}
        className="text-xs font-medium text-destructive underline underline-offset-2 hover:opacity-80 transition-opacity"
      >
        switch
      </button>
    );
  }

  return (
    <div className="flex items-center justify-between gap-3 py-1">
      <span className="text-sm text-muted-foreground">Status</span>
      <div className="flex items-center gap-2">
        {dot}
        <span className={`text-sm font-medium ${labelClass}`}>{label}</span>
        {action}
      </div>
    </div>
  );
}

/* ─── Contracts card ─────────────────────────────────────────────────── */

function ContractsCard() {
  return (
    <Card className="border-border bg-card">
      <CardHeader>
        <CardTitle className="text-base font-medium flex items-center gap-2">
          <FileCode2 className="w-4 h-4 text-muted-foreground" />
          Contract Addresses
        </CardTitle>
      </CardHeader>
      <CardContent className="divide-y divide-border">
        {CONTRACT_ROWS.map((row) => (
          <div
            key={row.label}
            className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
          >
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">{row.label}</p>
              <p className="text-xs text-muted-foreground">{row.description}</p>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <code
                className="font-mono text-xs text-muted-foreground hover:text-foreground transition-colors"
                title={row.address}
              >
                {truncateAddress(row.address)}
              </code>
              <CopyButton value={row.address} label={`Copy ${row.label} address`} />
              <a
                href={explorerAddressUrl(row.address)}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`View ${row.label} on Arcscan`}
                title="View on Arcscan"
                className="inline-flex items-center justify-center rounded p-1 text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

/* ─── Wallet card (gated on connection) ──────────────────────────────── */

function WalletCard() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const onArc = chainId === arcTestnet.id;

  // `useBalance` with no `token` arg reads the native balance — which IS
  // USDC on Arc (chain.nativeCurrency.decimals = 6). Pinned to CHAIN_ID
  // so we don't accidentally show a wrong-chain balance.
  const { data: balance, isLoading: balanceLoading } = useBalance({
    address,
    chainId: CHAIN_ID,
    query: { enabled: !!address && onArc },
  });

  // Pre-mount or disconnected: render nothing. We intentionally don't show
  // a placeholder here — the Network card already surfaces "wallet not
  // connected" status. Avoid double signal.
  if (!mounted || !isConnected || !address) return null;

  return (
    <Card className="border-border bg-card">
      <CardHeader>
        <CardTitle className="text-base font-medium flex items-center gap-2">
          <Wallet className="w-4 h-4 text-muted-foreground" />
          Wallet
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between gap-3 py-1">
          <span className="text-sm text-muted-foreground">Address</span>
          <div className="flex items-center gap-1 min-w-0">
            <code
              className="font-mono text-xs text-foreground truncate"
              title={address}
            >
              {truncateAddress(address, 8, 6)}
            </code>
            <CopyButton value={address} label="Copy wallet address" />
            <a
              href={explorerAddressUrl(address)}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="View wallet on Arcscan"
              title="View on Arcscan"
              className="inline-flex items-center justify-center rounded p-1 text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 py-1">
          <span className="text-sm text-muted-foreground flex items-center gap-2">
            <Coins className="w-3.5 h-3.5" />
            USDC Balance
          </span>
          {!onArc ? (
            <span className="text-sm text-muted-foreground/70 italic">
              switch to Arc to view
            </span>
          ) : balanceLoading ? (
            <span className="text-sm font-mono text-muted-foreground">…</span>
          ) : balance ? (
            <span className="text-sm font-mono font-medium text-foreground">
              {formatUsdc(balance.value)}{" "}
              <span className="text-xs text-muted-foreground">USDC</span>
            </span>
          ) : (
            <span className="text-sm font-mono text-muted-foreground">—</span>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 py-1">
          <span className="text-sm text-muted-foreground flex items-center gap-2">
            <ShieldCheck className="w-3.5 h-3.5" />
            Chain Match
          </span>
          <span
            className={`text-sm font-medium ${
              onArc ? "text-success" : "text-destructive"
            }`}
          >
            {onArc ? "On Arc Testnet" : `Wrong chain (id ${chainId})`}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

/* ─── About card ─────────────────────────────────────────────────────── */

function AboutCard() {
  return (
    <Card className="border-border bg-card">
      <CardHeader>
        <CardTitle className="text-base font-medium flex items-center gap-2">
          <Info className="w-4 h-4 text-muted-foreground" />
          About
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-foreground">
          Forge — an on-chain marketplace for autonomous agents, built on
          Arc with USDC-denominated jobs and ERC-8004 reputation.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2">
          <InfoRow label="Frontend version" value={FRONTEND_VERSION} mono />
          <InfoRow
            label="Source"
            valueNode={
              <a
                href={GITHUB_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-sm font-mono text-accent hover:underline"
              >
                <Github className="w-3.5 h-3.5" />
                {GITHUB_URL.replace(/^https?:\/\//, "")}
              </a>
            }
          />
          <InfoRow
            label="Docs"
            valueNode={
              <span
                className="inline-flex items-center gap-1 text-sm font-mono text-muted-foreground/70 cursor-not-allowed"
                title="Coming soon"
              >
                <Globe className="w-3.5 h-3.5" />
                coming soon
              </span>
            }
          />
          <InfoRow
            label="Status"
            valueNode={
              <span className="inline-flex items-center gap-1 text-sm font-medium text-success">
                <Activity className="w-3.5 h-3.5" />
                Testnet live
              </span>
            }
          />
        </div>
      </CardContent>
    </Card>
  );
}

/* ─── Shared layout primitives ───────────────────────────────────────── */

interface KeyValueRowProps {
  label: string;
  value: string;
  copyable?: boolean;
  /** When set, `value` is rendered as a link to this URL. */
  link?: string;
}

function KeyValueRow({ label, value, copyable, link }: KeyValueRowProps) {
  // Right-side value: link if `link`, plain code otherwise.
  const valueNode = link ? (
    <a
      href={link}
      target="_blank"
      rel="noopener noreferrer"
      className="font-mono text-xs text-accent hover:underline truncate"
    >
      {value}
    </a>
  ) : (
    <code className="font-mono text-xs text-foreground break-all">
      {value}
    </code>
  );

  return (
    <div className="flex items-center justify-between gap-3 py-1">
      <span className="text-sm text-muted-foreground">{label}</span>
      <div className="flex items-center gap-1 min-w-0 max-w-[60%] justify-end">
        {valueNode}
        {copyable && <CopyButton value={value} label={`Copy ${label}`} />}
        {link && (
          <a
            href={link}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Open ${label}`}
            title={`Open ${label}`}
            className="inline-flex items-center justify-center rounded p-1 text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        )}
      </div>
    </div>
  );
}

interface InfoRowProps {
  label: string;
  value?: string;
  valueNode?: React.ReactNode;
  mono?: boolean;
}

function InfoRow({ label, value, valueNode, mono }: InfoRowProps) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-muted-foreground uppercase tracking-wide">
        {label}
      </span>
      {valueNode ?? (
        <span
          className={`text-sm text-foreground ${mono ? "font-mono" : ""}`}
        >
          {value}
        </span>
      )}
    </div>
  );
}

