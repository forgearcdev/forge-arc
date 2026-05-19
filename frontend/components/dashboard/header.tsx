"use client";

import { cn } from "@/lib/utils";
import type { Section } from "@/app/app/page";
import { Search, Calendar } from "lucide-react";
import { useState } from "react";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { NetworkIndicator } from "@/components/dashboard/network-indicator";

interface HeaderProps {
  activeSection: Section;
}

const sectionTitles: Record<Section, string> = {
  overview: "Overview",
  pipeline: "Jobs",
  deals: "Open Jobs",
  team: "My Activity",
  customers: "Agents",
  settings: "Settings",
};

export function Header({ activeSection }: HeaderProps) {
  const [searchFocused, setSearchFocused] = useState(false);

  return (
    <header className="h-16 border-b border-border bg-background/80 backdrop-blur-sm sticky top-0 z-30 flex items-center justify-between px-6">
      <div className="flex items-center gap-6">
        <h1 className="text-xl font-semibold text-foreground">
          {sectionTitles[activeSection]}
        </h1>
        <div className="hidden md:flex items-center gap-2 text-sm text-muted-foreground">
          <Calendar className="w-4 h-4" />
          <span>Last 24 hours</span>
        </div>
      </div>

      <div className="flex items-center gap-4">
        {/* Search */}
        <div
          className={cn(
            "relative flex items-center transition-all duration-300",
            searchFocused ? "w-64" : "w-48"
          )}
        >
          <Search className="absolute left-3 w-4 h-4 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            placeholder="Search jobs..."
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setSearchFocused(false)}
            className="w-full h-9 pl-9 pr-4 rounded-lg bg-secondary border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-accent transition-all duration-200"
          />
        </div>

        {/* Network indicator — live wagmi state. See network-indicator.tsx. */}
        <NetworkIndicator />

        {/* Connect Wallet — RainbowKit ConnectButton with full styling control.
            ConnectButton.Custom is the headless API: we get the open*Modal
            callbacks + the live account/chain state, and we render whatever
            UI we want. The `mounted` flag guards against SSR-mismatch by
            hiding the button until after client hydration. */}
        <ConnectButton.Custom>
          {({
            account,
            chain,
            openAccountModal,
            openChainModal,
            openConnectModal,
            mounted,
          }) => {
            const ready = mounted;
            const connected = ready && account && chain;

            return (
              <div
                {...(!ready && {
                  "aria-hidden": true,
                  style: {
                    opacity: 0,
                    pointerEvents: "none",
                    userSelect: "none",
                  },
                })}
              >
                {(() => {
                  if (!connected) {
                    return (
                      <button
                        onClick={openConnectModal}
                        type="button"
                        className="px-4 py-2 rounded-lg border-2 border-accent text-accent text-sm font-medium hover:bg-accent/10 transition-all duration-200"
                      >
                        Connect Wallet
                      </button>
                    );
                  }

                  if (chain.unsupported) {
                    return (
                      <button
                        onClick={openChainModal}
                        type="button"
                        className="px-4 py-2 rounded-lg border-2 border-destructive text-destructive text-sm font-medium hover:bg-destructive/10 transition-all duration-200"
                      >
                        Wrong network
                      </button>
                    );
                  }

                  return (
                    <div className="flex items-center gap-2">
                      <button
                        onClick={openChainModal}
                        type="button"
                        className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-secondary/50 text-sm text-foreground hover:bg-secondary transition-all duration-200"
                      >
                        {chain.hasIcon && chain.iconUrl && (
                          // RainbowKit ships chain icons; for Arc testnet
                          // we won't have one and this conditional just
                          // skips the <img> cleanly.
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            alt={chain.name ?? "chain icon"}
                            src={chain.iconUrl}
                            className="w-4 h-4 rounded-full"
                          />
                        )}
                        <span className="font-mono">{chain.name}</span>
                      </button>
                      <button
                        onClick={openAccountModal}
                        type="button"
                        className="px-3 py-2 rounded-lg border-2 border-accent text-accent text-sm font-mono font-medium hover:bg-accent/10 transition-all duration-200"
                      >
                        {account.displayName}
                      </button>
                    </div>
                  );
                })()}
              </div>
            );
          }}
        </ConnectButton.Custom>
      </div>
    </header>
  );
}
