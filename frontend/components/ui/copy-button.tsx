"use client";

/**
 * Reusable click-to-copy button.
 *
 * Renders a Copy icon by default; on click, copies `value` to the clipboard
 * and swaps to a green Check icon for ~1.5 seconds before reverting. Uses
 * `navigator.clipboard.writeText` — gracefully no-ops on browsers without
 * clipboard support (legacy / non-HTTPS contexts), where the icon just
 * stays as Copy.
 *
 * Why a dedicated component instead of inlining the pattern: the Settings
 * page has 6+ copy targets (RPC URL, chain ID, 5 contract addresses) and
 * we'll reuse this on Jobs / Agents detail rows in later sub-phases.
 */

import { useState, useCallback } from "react";
import { Copy, Check } from "lucide-react";
import { cn } from "@/lib/utils";

interface CopyButtonProps {
  /** The text to copy to clipboard. */
  value: string;
  /** Accessible label. Defaults to "Copy". Read by screen readers. */
  label?: string;
  /** Optional extra classes on the outer button. */
  className?: string;
  /** Icon size in pixels. Defaults to 14 (matches `text-xs` line-height). */
  size?: number;
}

export function CopyButton({
  value,
  label = "Copy",
  className,
  size = 14,
}: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  const handleClick = useCallback(async () => {
    // Older browsers / file:// contexts lack `navigator.clipboard`. Bail
    // gracefully rather than crashing — the user can still select the text
    // manually since we render it next to the button.
    if (typeof navigator === "undefined" || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      // 1.5s feels long enough to register the success but short enough that
      // a user clicking twice in rapid succession gets feedback both times.
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard permission denied (rare). Silent fail; UI just doesn't
      // animate.
    }
  }, [value]);

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={copied ? "Copied" : label}
      title={copied ? "Copied!" : label}
      className={cn(
        "inline-flex items-center justify-center rounded p-1 text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent",
        className,
      )}
    >
      {copied ? (
        <Check className="text-success" style={{ width: size, height: size }} />
      ) : (
        <Copy style={{ width: size, height: size }} />
      )}
    </button>
  );
}
