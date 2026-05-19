"use client";

/**
 * Register Agent dialog — Phase 5f.3 (live tx flow).
 *
 * **Architecture.** The dialog state is *derived* from wagmi's hook
 * outputs via `useMemo`, not stored in a separate `useState`. The
 * transition graph is:
 *
 *   no hook output     → idle
 *   isWritePending     → submitting  (wallet popup open)
 *   txHash returned    → confirming  (broadcast, awaiting receipt)
 *   receipt returned   → success     (parse Transfer log) | error (revert)
 *   writeError         → error       (rejection / RPC failure)
 *   receiptError       → error       (mining timeout / fail)
 *
 * Single source of truth simplifies the reset flow — `resetWrite()`
 * clears wagmi's tx state, and the memo recomputes back to idle. No
 * stale state between the local discriminated union and wagmi's
 * internal cache.
 *
 * **Agent-id extraction.** SECURITY-RELEVANT: the contract's `register`
 * returns the new agentId, but wagmi can't surface that return value
 * after broadcast (the simulation result is unreliable — see the note
 * in `lib/abi/identity-registry.ts`: the global counter races against
 * any third-party minter on the public registry). We parse the
 * Transfer event from the receipt logs instead, using
 * `IDENTITY_REGISTRY_TRANSFER_EVENT` + `parseEventLogs`, filtered to
 * `from === zeroAddress` (the mint marker) and
 * `address === IdentityRegistry proxy`.
 *
 * **Known v1 constraint (Phase 5f).** The Agents table draws its rows
 * from `useAgents`, which derives the agentId set from
 * `JobEscrow.jobs[].agentId` — i.e. only agents that have been HIRED
 * at least once. A fresh mint won't appear in the table until its
 * first job. The success-state copy sets this expectation
 * explicitly. See `learning_useAgents_aggregation_source.md` in
 * memory for the full rationale.
 *
 * ---
 *
 * **Trigger API deviation from the original plan.** The plan called for
 * "Trigger: pass as children prop". I went with controlled
 * (`open` + `onOpenChange`) instead because the `<RequiresWallet>`
 * wrapper that gates the trigger button does a `cloneElement` to swap
 * `onClick` when the wallet is disconnected — and `cloneElement` only
 * reaches one level deep, so it can't substitute the click handler on a
 * `<button>` nested inside `<RegisterAgentDialog>`. The Radix `Slot`
 * pattern (`<DialogTrigger asChild>`) doesn't help either, since it
 * composes both onClick handlers (opening the connect modal AND the
 * dialog) which is the wrong UX. Controlled is the cleanest separation:
 * customers.tsx owns the open state, RequiresWallet gates the trigger
 * button, dialog renders next to it.
 */

import { useEffect, useMemo, useState } from "react";
import {
  useAccount,
  useChainId,
  useSwitchChain,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import { useQueryClient } from "@tanstack/react-query";
import { parseEventLogs, zeroAddress } from "viem";
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  ExternalLink,
  Loader2,
  Wallet,
  XCircle,
} from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CopyButton } from "@/components/ui/copy-button";
import {
  IDENTITY_REGISTRY_ABI,
  IDENTITY_REGISTRY_TRANSFER_EVENT,
} from "@/lib/abi/identity-registry";
import { CHAIN_ID, CONTRACT_ADDRESSES } from "@/lib/contracts";
import { arcTestnet } from "@/lib/chains";

const EXPLORER_URL = arcTestnet.blockExplorers?.default.url ?? "";

/* ─── State machine ──────────────────────────────────────────────────
 *
 * Discriminated union forces the UI to handle every possible state.
 * Per-kind fields are exactly what that state needs to render — `txHash`
 * only exists once we've broadcast, `agentId` only exists once the
 * receipt has been parsed, `reason` only exists on failure. TypeScript
 * makes "rendering txHash in idle" a compile error.
 */
type DialogState =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "confirming"; txHash: `0x${string}` }
  | { kind: "success"; agentId: bigint; txHash: `0x${string}` }
  | { kind: "error"; reason: string };

/* ─── URI validation ─────────────────────────────────────────────────
 *
 * Permissive: empty is valid (smoke test uses ""), and any ipfs:// or
 * https:// URI passes. Anything else is rejected with a helpful message.
 * IdentityRegistry doesn't validate format on-chain (verified in
 * `contracts/script/SmokeTest.s.sol:111` — "IdentityRegistry just stores
 * the string"), so this guard is purely to prevent typos the user will
 * regret post-mint (e.g. accidentally typing a CID without the prefix).
 */
type UriValidation = { ok: true } | { ok: false; reason: string };

function validateMetadataURI(value: string): UriValidation {
  if (value.length === 0) return { ok: true };
  if (value.startsWith("ipfs://") || value.startsWith("https://")) {
    return { ok: true };
  }
  return {
    ok: false,
    reason: "URI must start with ipfs:// or https:// (or leave empty)",
  };
}

/* ─── Helpers (mirror customers.tsx; extract on 4th caller) ──────── */

function truncateAddress(addr: string, head = 6, tail = 4): string {
  if (addr.length <= head + tail + 2) return addr;
  return `${addr.slice(0, head + 2)}…${addr.slice(-tail)}`;
}

function agentNftUrl(agentId: bigint): string {
  // Arcscan NFT token page format — same as the one used in customers.tsx
  // for "View on Arcscan" on existing agents.
  return `${EXPLORER_URL}/token/${CONTRACT_ADDRESSES.identityRegistry}?a=${agentId.toString()}`;
}

function txUrl(txHash: `0x${string}`): string {
  return `${EXPLORER_URL}/tx/${txHash}`;
}

/* ─── Friendly error mapping ─────────────────────────────────────────
 *
 * Maps the wagmi / viem error surface to short user-friendly messages.
 * Three common cases get explicit handling; everything else falls back
 * to `shortMessage` (viem's clean one-liner) or a generic message.
 *
 * Detection is text-based because wagmi v2 throws a tree of nested
 * BaseError subclasses without a single stable discriminator across
 * provider versions. Doing it by string-search on the message is ugly
 * but robust to MetaMask / Rabby / RainbowKit injecting their own
 * wording.
 */
function friendlyError(err: unknown): string {
  if (!err) return "Mint failed — see console for details.";
  const e = err as {
    shortMessage?: string;
    message?: string;
    name?: string;
  };
  const text = `${e.shortMessage ?? ""} ${e.message ?? ""}`.toLowerCase();
  if (
    e.name === "UserRejectedRequestError" ||
    text.includes("user rejected") ||
    text.includes("user denied") ||
    text.includes("rejected the request")
  ) {
    return "Transaction cancelled in your wallet.";
  }
  if (text.includes("insufficient funds")) {
    return "Insufficient USDC for gas on Arc testnet. Top up and try again.";
  }
  if (text.includes("timeout") || text.includes("timed out")) {
    return "Transaction may have succeeded — check Arcscan.";
  }
  return e.shortMessage ?? "Mint failed — see console for details.";
}

/* ─── Component ─────────────────────────────────────────────────────── */

interface RegisterAgentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function RegisterAgentDialog({
  open,
  onOpenChange,
}: RegisterAgentDialogProps) {
  const { address } = useAccount();
  const chainId = useChainId();
  const { switchChain, isPending: isSwitchPending } = useSwitchChain();
  const queryClient = useQueryClient();

  /* ── Tx-submission hook (signature step). `data` is the tx hash once
   *    the wallet has signed and broadcast it. `error` covers the whole
   *    "user clicked the popup, then…" surface — including rejections
   *    and provider errors. `reset` clears both so we can return to a
   *    fresh idle state on dialog reopen or "Try again". */
  const {
    writeContract,
    data: txHash,
    isPending: isWritePending,
    error: writeError,
    reset: resetWrite,
  } = useWriteContract();

  /* ── Receipt-waiting hook (mining step). Polls until the tx is in a
   *    block, then returns the receipt with logs. `chainId: CHAIN_ID`
   *    pins it to Arc Testnet regardless of which chain the wallet
   *    currently has selected (defensive against quick chain switches
   *    mid-flight). */
  const { data: receipt, error: receiptError } = useWaitForTransactionReceipt(
    {
      hash: txHash,
      chainId: CHAIN_ID,
    },
  );

  const [uri, setUri] = useState("");

  const onWrongChain = chainId !== CHAIN_ID;
  const uriValidation = validateMetadataURI(uri);

  /* ── Derived state from wagmi hooks. Single source of truth — no
   *    second useState for `state`. The transitions form naturally:
   *    no hook output  → idle
   *    isWritePending  → submitting (wallet popup is open)
   *    txHash present  → confirming (broadcast, waiting for receipt)
   *    receipt present → success (parse Transfer log) | error (revert)
   *    writeError      → error  (rejection / RPC fail)
   *    receiptError    → error  (mining-side fail / timeout)
   *
   *    Memoizing the union: per-`kind` payloads (txHash, agentId, reason)
   *    travel together with the discriminator, so the JSX never has to
   *    null-check txHash inside a "confirming" branch. */
  const state: DialogState = useMemo(() => {
    if (writeError) return { kind: "error", reason: friendlyError(writeError) };
    if (receiptError)
      return { kind: "error", reason: friendlyError(receiptError) };
    if (receipt) {
      // Reverted tx still has a receipt — distinguish via status.
      if (receipt.status === "reverted") {
        return {
          kind: "error",
          reason: "Transaction reverted onchain — agent not minted.",
        };
      }
      // Extract the agentId from the Transfer event in the receipt
      // logs. SECURITY: the function return value is unreliable (the
      // agentId counter is global, see the comment in
      // lib/abi/identity-registry.ts). The receipt's Transfer log is
      // the only ground-truth source.
      const decoded = parseEventLogs({
        abi: [IDENTITY_REGISTRY_TRANSFER_EVENT],
        logs: receipt.logs,
        eventName: "Transfer",
      });
      const mintLog = decoded.find(
        (l) =>
          l.address.toLowerCase() ===
            CONTRACT_ADDRESSES.identityRegistry.toLowerCase() &&
          l.args.from.toLowerCase() === zeroAddress.toLowerCase(),
      );
      if (!mintLog) {
        // This should never happen if the registry's register() honors
        // ERC-721 invariants. If it does, surface it loudly rather than
        // papering over — we'd rather the user see a confusing error
        // than silently lose the minted agentId.
        return {
          kind: "error",
          reason:
            "Mint succeeded but no Transfer event found in receipt. Check Arcscan for the actual tx.",
        };
      }
      return {
        kind: "success",
        agentId: mintLog.args.tokenId,
        txHash: receipt.transactionHash,
      };
    }
    if (txHash) return { kind: "confirming", txHash };
    if (isWritePending) return { kind: "submitting" };
    return { kind: "idle" };
  }, [writeError, receiptError, receipt, txHash, isWritePending]);

  const isInFlight =
    state.kind === "submitting" || state.kind === "confirming";

  const canSubmit =
    state.kind === "idle" && !onWrongChain && uriValidation.ok;

  /* ── Cache invalidation on success. Runs once when the state machine
   *    crosses into "success". `useEffect` so the side-effect lives
   *    outside the render path. Invalidates by wagmi's internal query
   *    key prefixes (`readContract` / `readContracts`) — that matches
   *    every useReadContract / useReadContracts call across the app,
   *    including the JobEscrow reads in useJobStats and the
   *    IdentityRegistry ownerOf reads in useAgents. Also invalidates
   *    our custom-keyed log-scan queries.
   *
   *    Note (Phase 5f, see learning_useAgents_aggregation_source.md):
   *    useAgents derives its agentId set from JobEscrow.jobs[], so a
   *    freshly minted-but-unhired agent won't appear in the Agents
   *    table even after invalidation. That's an intentional v1
   *    constraint; the dialog's success state with the minted agentId
   *    is the confirmation. */
  useEffect(() => {
    if (state.kind === "success") {
      queryClient.invalidateQueries({ queryKey: ["readContract"] });
      queryClient.invalidateQueries({ queryKey: ["readContracts"] });
      queryClient.invalidateQueries({ queryKey: ["payment-history"] });
      queryClient.invalidateQueries({ queryKey: ["job-creation-meta"] });
    }
  }, [state.kind, queryClient]);

  /* ── Reset on dialog open. resetWrite() clears wagmi's internal
   *    txHash + error → derived state recomputes to "idle". The URI is
   *    cleared too so a fresh open doesn't carry over a previous
   *    attempt's metadata. */
  useEffect(() => {
    if (open) {
      resetWrite();
      setUri("");
    }
  }, [open, resetWrite]);

  /* ── Open-state interception. Blocks all close attempts (X button,
   *    Escape key, outside click) while a tx is mid-flight. The tx
   *    still goes through onchain regardless of the dialog state, but
   *    the user shouldn't be able to lose visibility by accidentally
   *    dismissing while waiting for confirmation. */
  const handleOpenChange = (next: boolean) => {
    if (!next && isInFlight) return;
    onOpenChange(next);
  };

  const handleMint = () => {
    // No setState — the derived `state` recomputes as soon as wagmi
    // flips `isWritePending` to true (next render after this call).
    // wagmi's args inference: register() takes one string param, so
    // [uri] is the correct tuple shape.
    writeContract({
      address: CONTRACT_ADDRESSES.identityRegistry,
      abi: IDENTITY_REGISTRY_ABI,
      functionName: "register",
      args: [uri],
      chainId: CHAIN_ID,
    });
  };

  // "Try again" from error state: clear wagmi's tx state. Derived state
  // returns to idle. URI is preserved so the user doesn't retype.
  const handleTryAgain = () => resetWrite();

  const handleClose = () => onOpenChange(false);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="sm:max-w-md"
        // Hide the X close button while a tx is in flight — keeps the
        // user from clicking it and being confused when nothing happens
        // (handleOpenChange would no-op the close). Same intent as the
        // outside-click / escape guards.
        showCloseButton={!isInFlight}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bot className="w-5 h-5 text-accent" />
            Register Agent
          </DialogTitle>
          <DialogDescription>
            Mint a new ERC-8004 agent NFT on Arc testnet. You&apos;ll be
            the owner — other clients can hire your agent by referencing
            its agentId in a job.
          </DialogDescription>
        </DialogHeader>

        {/* Chain pre-flight: warning + one-click switch when on the wrong
         *  network. Rendered above the state body so it's the first
         *  thing the user sees if their wallet jumped to mainnet by
         *  accident. */}
        {onWrongChain && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
            <div className="text-xs flex-1">
              <p className="text-destructive font-medium">Wrong network</p>
              <p className="text-muted-foreground mt-0.5">
                You&apos;re on chain {chainId}. Switch to{" "}
                {arcTestnet.name} (chain {CHAIN_ID}) to mint.
              </p>
              <button
                type="button"
                onClick={() => switchChain({ chainId: CHAIN_ID })}
                disabled={isSwitchPending}
                className="mt-2 text-accent hover:underline disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSwitchPending
                  ? "Switching…"
                  : `Switch to ${arcTestnet.name}`}
              </button>
            </div>
          </div>
        )}

        {/* State-specific body — exhaustively typed by the discriminated
         *  union; adding a new state kind would force a new branch here. */}
        {state.kind === "idle" && (
          <IdleBody
            uri={uri}
            onChangeUri={setUri}
            validation={uriValidation}
            address={address}
          />
        )}
        {state.kind === "submitting" && <SubmittingBody />}
        {state.kind === "confirming" && (
          <ConfirmingBody txHash={state.txHash} />
        )}
        {state.kind === "success" && (
          <SuccessBody agentId={state.agentId} txHash={state.txHash} />
        )}
        {state.kind === "error" && <ErrorBody reason={state.reason} />}

        {/* Footer — state-dependent CTAs */}
        <DialogFooter className="gap-2">
          {state.kind === "idle" && (
            <>
              <Button variant="ghost" onClick={handleClose}>
                Cancel
              </Button>
              <Button
                onClick={handleMint}
                disabled={!canSubmit}
                className="bg-accent text-accent-foreground hover:bg-accent/90"
              >
                Mint Agent
              </Button>
            </>
          )}

          {(state.kind === "submitting" ||
            state.kind === "confirming") && (
            <Button
              disabled
              className="bg-accent/50 text-accent-foreground"
            >
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              {state.kind === "submitting"
                ? "Confirming in wallet…"
                : "Mining…"}
            </Button>
          )}

          {state.kind === "success" && (
            <>
              <Button variant="ghost" asChild>
                <a
                  href={agentNftUrl(state.agentId)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  View on Arcscan
                  <ExternalLink className="w-3.5 h-3.5 ml-1.5" />
                </a>
              </Button>
              <Button onClick={handleClose}>Done</Button>
            </>
          )}

          {state.kind === "error" && (
            <>
              <Button variant="ghost" onClick={handleTryAgain}>
                Try again
              </Button>
              <Button onClick={handleClose} variant="secondary">
                Close
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ─── State-body subcomponents ────────────────────────────────────── */

function IdleBody({
  uri,
  onChangeUri,
  validation,
  address,
}: {
  uri: string;
  onChangeUri: (v: string) => void;
  validation: UriValidation;
  address: `0x${string}` | undefined;
}) {
  return (
    <div className="space-y-4">
      {/* Wallet readout — gives the user a chance to notice "wait, this
       *  is the wrong wallet" before paying gas. */}
      {address && (
        <div className="flex items-center justify-between rounded-lg border border-border bg-secondary/30 px-3 py-2">
          <span className="text-xs text-muted-foreground flex items-center gap-1.5">
            <Wallet className="w-3.5 h-3.5" />
            Minting to
          </span>
          <span className="flex items-center gap-1">
            <code className="font-mono text-xs text-foreground">
              {truncateAddress(address, 6, 4)}
            </code>
            <CopyButton value={address} label="Copy wallet address" />
          </span>
        </div>
      )}

      {/* URI field */}
      <div className="space-y-1.5">
        <label
          htmlFor="metadata-uri"
          className="text-xs font-medium text-muted-foreground uppercase tracking-wide block"
        >
          Metadata URI (optional)
        </label>
        <Input
          id="metadata-uri"
          type="text"
          value={uri}
          onChange={(e) => onChangeUri(e.target.value)}
          placeholder="ipfs://… or https://… or leave empty"
          aria-invalid={!validation.ok}
          className="font-mono text-xs"
        />
        {validation.ok ? (
          <p className="text-xs text-muted-foreground">
            Leave empty to mint without metadata. The contract stores the
            string as-is — no validation on-chain.
          </p>
        ) : (
          <p className="text-xs text-destructive">{validation.reason}</p>
        )}
      </div>
    </div>
  );
}

function SubmittingBody() {
  return (
    <div className="flex flex-col items-center justify-center py-8 gap-3 text-center">
      <Loader2 className="w-8 h-8 text-accent animate-spin" />
      <div>
        <p className="text-sm font-medium text-foreground">
          Confirm in your wallet
        </p>
        <p className="text-xs text-muted-foreground mt-1 max-w-xs">
          MetaMask should be prompting you to sign the register()
          transaction. We&apos;ll wait here.
        </p>
      </div>
    </div>
  );
}

function ConfirmingBody({ txHash }: { txHash: `0x${string}` }) {
  return (
    <div className="flex flex-col items-center justify-center py-8 gap-3 text-center">
      <Loader2 className="w-8 h-8 text-accent animate-spin" />
      <div>
        <p className="text-sm font-medium text-foreground">
          Waiting for confirmation
        </p>
        <p className="text-xs text-muted-foreground mt-1 max-w-xs">
          Transaction broadcast — Arc usually confirms in 1–2 seconds.
        </p>
        <a
          href={txUrl(txHash)}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 inline-flex items-center gap-1 text-xs text-accent hover:underline font-mono"
        >
          {truncateAddress(txHash, 8, 6)}
          <ExternalLink className="w-3 h-3" />
        </a>
      </div>
    </div>
  );
}

function SuccessBody({
  agentId,
  txHash,
}: {
  agentId: bigint;
  txHash: `0x${string}`;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-6 gap-3 text-center">
      <div className="w-12 h-12 rounded-full bg-success/10 flex items-center justify-center">
        <CheckCircle2 className="w-7 h-7 text-success" />
      </div>
      <div>
        <p className="text-base font-semibold text-foreground">
          Agent #{agentId.toString()} minted!
        </p>
        {/* Copy here is intentionally explicit about the v1 data-source
         *  quirk: the Agents table draws its rows from agents that have
         *  been HIRED at least once (useAgents derives the agentId set
         *  from JobEscrow.jobs[].agentId, see
         *  learning_useAgents_aggregation_source.md). A fresh mint won't
         *  appear there until someone funds a job for it. Setting that
         *  expectation here turns a limitation into a design statement. */}
        <p className="text-xs text-muted-foreground mt-1 max-w-xs">
          Your agent #{agentId.toString()} is registered on the ERC-8004
          IdentityRegistry. It will appear in the Agents table once it&apos;s
          hired for its first job. Until then, share your agentId with
          clients who want to post jobs for you.
        </p>
        <a
          href={txUrl(txHash)}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground font-mono"
        >
          {truncateAddress(txHash, 8, 6)}
          <ExternalLink className="w-3 h-3" />
        </a>
      </div>
    </div>
  );
}

function ErrorBody({ reason }: { reason: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-6 gap-3 text-center">
      <div className="w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center">
        <XCircle className="w-7 h-7 text-destructive" />
      </div>
      <div>
        <p className="text-base font-semibold text-foreground">
          Mint failed
        </p>
        <p className="text-xs text-muted-foreground mt-1 max-w-xs">
          {reason}
        </p>
      </div>
    </div>
  );
}
