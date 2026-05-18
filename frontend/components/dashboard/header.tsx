"use client";

import { cn } from "@/lib/utils";
import type { Section } from "@/app/page";
import { Search, Calendar } from "lucide-react";
import { useState } from "react";

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

        {/* Network indicator */}
        <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-lg bg-secondary/50">
          <span className="w-2 h-2 bg-success rounded-full animate-pulse" />
          <span className="text-sm font-mono text-muted-foreground">arc testnet</span>
        </div>

        {/* Connect Wallet button */}
        <button className="px-4 py-2 rounded-lg border-2 border-accent text-accent text-sm font-medium hover:bg-accent/10 transition-all duration-200">
          Connect Wallet
        </button>
      </div>
    </header>
  );
}
