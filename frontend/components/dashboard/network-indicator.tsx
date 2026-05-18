"use client";

/**
 * Live chain-state pill for the header.
 *
 * Three visual states (post-hydration):
 *   1. disconnected           → gray dot + "arc testnet" label (intended-chain hint)
 *   2. connected, Arc Testnet → green pulsing dot + "arc testnet"
 *   3. connected, wrong chain → red pulsing dot + actual chain name + inline "switch" link
 *
 * Pre-hydration (SSR + first client paint): renders the disconnected state at
 * 60% opacity. This avoids the hydration flicker that would otherwise happen
 * if we returned `null` during SSR — the layout would jump when the pill
 * appears post-mount. Keeping the same DOM shape both phases and just
 * tweaking opacity gives a smooth fade-in.
 */

import { useAccount, useChainId, useSwitchChain } from "wagmi";
import { useEffect, useState } from "react";
import { arcTestnet } from "@/lib/chains";

/**
 * Friendly names for chains a user might accidentally be connected to. Not a
 * full registry — just the most common "wrong networks" people land on. For
 * anything else we fall back to `chain <id>` which is at least unambiguous.
 */
const WRONG_CHAIN_NAMES: Record<number, string> = {
  1: "ethereum",
  10: "optimism",
  56: "bnb chain",
  137: "polygon",
  8453: "base",
  42161: "arbitrum",
  11155111: "ethereum sepolia",
  84532: "base sepolia",
};

export function NetworkIndicator() {
  // mounted guard: pre-hydration, we don't yet know the wallet's chain. We
  // render a disconnected-shaped placeholder at reduced opacity, then fade
  // in to the real state once useEffect fires (i.e. after first client
  // render). Same pattern RainbowKit's ConnectButton.Custom uses internally.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const { isConnected } = useAccount();
  const chainId = useChainId();
  const { switchChain } = useSwitchChain();

  const onArc = chainId === arcTestnet.id;

  // Pre-hydration placeholder — same shape as the disconnected state, dim.
  if (!mounted) {
    return (
      <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-lg bg-secondary/50 opacity-60">
        <span className="w-2 h-2 bg-muted-foreground/60 rounded-full" />
        <span className="text-sm font-mono text-muted-foreground">arc testnet</span>
      </div>
    );
  }

  // Disconnected — same look as pre-hydration but full opacity.
  if (!isConnected) {
    return (
      <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-lg bg-secondary/50">
        <span className="w-2 h-2 bg-muted-foreground/60 rounded-full" />
        <span className="text-sm font-mono text-muted-foreground">arc testnet</span>
      </div>
    );
  }

  // Connected to Arc Testnet — happy path.
  if (onArc) {
    return (
      <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-lg bg-secondary/50">
        <span className="w-2 h-2 bg-success rounded-full animate-pulse" />
        <span className="text-sm font-mono text-muted-foreground">arc testnet</span>
      </div>
    );
  }

  // Connected to a different chain — surface the name and a one-click switch.
  const wrongName = WRONG_CHAIN_NAMES[chainId] ?? `chain ${chainId}`;

  return (
    <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-lg bg-destructive/10 border border-destructive/30">
      <span className="w-2 h-2 bg-destructive rounded-full animate-pulse" />
      <span className="text-sm font-mono text-destructive">{wrongName}</span>
      <button
        type="button"
        onClick={() => switchChain({ chainId: arcTestnet.id })}
        className="text-xs font-medium text-destructive underline underline-offset-2 hover:opacity-80 transition-opacity"
      >
        switch
      </button>
    </div>
  );
}
