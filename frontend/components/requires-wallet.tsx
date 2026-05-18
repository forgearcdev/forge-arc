"use client";

/**
 * Wallet-gate wrapper for action buttons.
 *
 * Wraps any single button-like element with:
 *   - When connected: passes the child through unchanged (zero wrapping cost)
 *   - When disconnected:
 *       * visual disabled state (50% opacity)
 *       * cursor stays `pointer` because the click IS valid — it opens
 *         RainbowKit's connect modal rather than running the original action
 *       * tooltip explains why
 *
 * The deliberate UX choice: a "disabled" wallet-gated button that's still
 * clickable. Hard-disabling would make it a dead-end; routing the click to
 * the connect modal turns the gate into a clear path forward.
 *
 * Usage:
 *
 *     <RequiresWallet message="Connect wallet to post a job">
 *       <button className="..." onClick={openPostJobModal}>Post Job</button>
 *     </RequiresWallet>
 *
 * The original `onClick` is overridden ONLY while disconnected. Once
 * connected, the wrapper returns the child as-is and the original handler
 * fires normally.
 */

import { cloneElement, isValidElement, type ReactElement } from "react";
import { useAccount } from "wagmi";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface RequiresWalletProps {
  /** Single React element (button, Button, etc.) to gate. */
  children: ReactElement<{ onClick?: () => void; className?: string }>;
  /** Tooltip text shown on hover when disconnected. */
  message?: string;
}

export function RequiresWallet({
  children,
  message = "Connect wallet to continue",
}: RequiresWalletProps) {
  const { isConnected } = useAccount();
  const { openConnectModal } = useConnectModal();

  // Connected: child renders normally. No tooltip overhead, original onClick
  // intact, no opacity tweak. The wrapper is a no-op in the happy path.
  if (isConnected) return children;

  // Defensive: cloneElement requires a valid React element. If someone passes
  // text or fragments, just render disconnected as-is rather than throwing.
  if (!isValidElement(children)) return children;

  const childProps = children.props;

  // Clone the child, replacing only `onClick` and merging `opacity-50
  // cursor-pointer` into its className. We intentionally do NOT set the
  // `disabled` attribute — that would prevent the click event entirely and
  // defeat the whole point of routing the click to the connect modal.
  const gatedChild = cloneElement(children, {
    onClick: openConnectModal,
    className: cn(childProps.className, "opacity-50 cursor-pointer"),
  });

  return (
    <Tooltip>
      {/* asChild renders the gated button directly as the trigger — no extra
          <button> wrapper around our <button> (which would be invalid HTML). */}
      <TooltipTrigger asChild>{gatedChild}</TooltipTrigger>
      <TooltipContent>{message}</TooltipContent>
    </Tooltip>
  );
}
