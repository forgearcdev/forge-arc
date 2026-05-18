"use client";

import { cn } from "@/lib/utils";
import { TrendingUp, TrendingDown } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

interface MetricCardProps {
  title: string;
  /**
   * Pre-formatted display string. Pass `"—"` (em dash) for "no data yet"
   * states so they render visually as a single muted character rather than
   * a literal "null" or "0%".
   */
  value: string;
  valueSuffix?: string;
  /**
   * Trend indicator — both `change` and `changeType` must be supplied
   * together, or omit both to hide the trend block entirely. We hide it
   * for any metric where we don't yet have historical data to compare
   * against; better to show no trend than a fake one.
   */
  change?: string;
  changeType?: "positive" | "negative" | "neutral";
  icon: LucideIcon;
  delay?: number;
  useMono?: boolean;
  /** When true, replaces `value` with a skeleton block of equivalent height. */
  loading?: boolean;
}

export function MetricCard({
  title,
  value,
  valueSuffix,
  change,
  changeType,
  icon: Icon,
  delay = 0,
  useMono = false,
  loading = false,
}: MetricCardProps) {
  const hasTrend = change != null && changeType != null;

  return (
    <div
      className="group relative bg-card border border-border rounded-xl p-5 hover:border-accent/50 transition-all duration-300 overflow-hidden animate-in fade-in slide-in-from-bottom-4"
      style={{ animationDelay: `${delay * 100}ms`, animationFillMode: "both" }}
    >
      {/* Subtle gradient on hover */}
      <div className="absolute inset-0 bg-gradient-to-br from-accent/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />

      <div className="relative">
        <div className="flex items-start justify-between mb-3">
          <span className="text-sm text-muted-foreground font-medium">
            {title}
          </span>
          <div className="w-9 h-9 rounded-lg bg-secondary flex items-center justify-center group-hover:bg-accent/10 transition-colors duration-300">
            <Icon className="w-4 h-4 text-muted-foreground group-hover:text-accent transition-colors duration-300" />
          </div>
        </div>

        <div className="flex items-end gap-3">
          <div className="flex items-baseline gap-2">
            {loading ? (
              // Skeleton sized to match the value text height (~h-9 for
              // text-2xl/text-3xl). Use the muted secondary tone, not the
              // electric-blue accent — the default Skeleton bg would be too
              // loud for four side-by-side cards.
              <Skeleton className="h-9 w-20 bg-secondary" />
            ) : (
              <span
                className={cn(
                  "text-2xl lg:text-3xl font-bold text-foreground tracking-tight",
                  useMono && "font-mono"
                )}
              >
                {value}
              </span>
            )}
            {valueSuffix && !loading && (
              <span className="text-sm font-mono text-muted-foreground">{valueSuffix}</span>
            )}
          </div>
          {hasTrend && !loading && (
            <div
              className={cn(
                "flex items-center gap-1 text-sm font-medium mb-1",
                changeType === "positive" && "text-success",
                changeType === "negative" && "text-destructive",
                changeType === "neutral" && "text-muted-foreground"
              )}
            >
              {changeType === "positive" && <TrendingUp className="w-3.5 h-3.5" />}
              {changeType === "negative" && (
                <TrendingDown className="w-3.5 h-3.5" />
              )}
              <span>{change}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
