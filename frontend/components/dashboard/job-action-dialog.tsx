"use client";

/**
 * Job-action dialog — Phase 5h.
 *
 * One component, four `action` modes:
 *   - "submit"        →  JobEscrow.submit(jobId, deliverableURI)
 *                        agent NFT owner only; status must be Funded;
 *                        deadline must not yet have passed
 *   - "complete"      →  JobEscrow.complete(jobId, bytes32(0))
 *                        client only; status must be Submitted
 *   - "reject"        →  JobEscrow.reject(jobId, reasonBytes32)
 *                        client only; status must be Submitted; reason
 *                        is keccak256(toBytes(text)) if user typed
 *                        something, else bytes32(0)
 *   - "claim-refund"  →  JobEscrow.claimRefund(jobId)
 *                        anyone-connected; status must be Funded or
 *                        Submitted; deadline must have passed
 *
 * Architecture mirrors register-agent-dialog and post-job-dialog:
 *   - Derived state via useMemo over wagmi hook outputs (no separate
 *     useState for the state machine)
 *   - 5-state union (idle / submitting / confirming / success / error)
 *     — these four actions share the simple shape since they're all
 *     single-tx flows
 *   - Per-action body content keyed off `action` prop
 *   - Single useWriteContract handles all four functions; we just pass
 *     different (functionName, args) per call
 *
 * **bytes32 reason semantics** (intentional for v1):
 *   The contract's `reason` is an arbitrary acceptance/rejection note,
 *   NOT a hash of the deliverable. SmokeTestV2.s.sol confirms this by
 *   passing `bytes32(0)` for complete. We mirror that:
 *     - complete:     always passes bytes32(0) (no input field)
 *     - reject:       empty input → bytes32(0)
 *                     non-empty   → keccak256(toBytes(text)) → bytes32
 *     - reasoning: a 32-byte cap on free-form text would truncate
 *       longer rejection notes silently. A keccak256 fingerprint
 *       commits to the full reason on-chain (verifiable later if the
 *       client also publishes the raw text off-chain). Better than a
 *       padded ASCII slice that could lose information.
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
import { keccak256, toBytes } from "viem";
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  Clock,
  ExternalLink,
  Loader2,
  Send,
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
import { JOB_ESCROW_ABI } from "@/lib/abi/job-escrow";
import { CHAIN_ID, CONTRACT_ADDRESSES } from "@/lib/contracts";
import { arcTestnet } from "@/lib/chains";
import { formatUnits } from "viem";
import type { RecentJob } from "@/hooks/use-recent-jobs";

const EXPLORER_URL = arcTestnet.blockExplorers?.default.url ?? "";

/* ─── Action enum ─────────────────────────────────────────────────── */

export type JobAction = "submit" | "complete" | "reject" | "claim-refund";

/* ─── State machine (5 states — single-tx flow) ──────────────────── */

type DialogState =
  | { kind: "idle" }
  | { kind: "submitting" } // wallet popup open
  | { kind: "confirming"; txHash: `0x${string}` } // broadcast, awaiting receipt
  | { kind: "success"; txHash: `0x${string}` }
  | { kind: "error"; reason: string };

/* ─── URI validation (submit only) ────────────────────────────────── */

type UriValidation = { ok: true } | { ok: false; reason: string };

function validateDeliverableURI(value: string): UriValidation {
  // Contract enforces non-empty (`EmptyDeliverable` revert at line ~503
  // of JobEscrow.sol). Mirror that here for fail-fast UX. Same permissive
  // ipfs:// / https:// pattern as register-agent-dialog.tsx — the
  // contract doesn't validate format on-chain, this is purely a typo
  // guard.
  if (value.trim().length === 0) {
    return { ok: false, reason: "Deliverable URI required" };
  }
  if (
    value.startsWith("ipfs://") ||
    value.startsWith("https://")
  ) {
    return { ok: true };
  }
  return {
    ok: false,
    reason: "URI must start with ipfs:// or https://",
  };
}

/* ─── Helpers (mirror other dialogs) ──────────────────────────────── */

function truncateAddress(addr: string, head = 6, tail = 4): string {
  if (addr.length <= head + tail + 2) return addr;
  return `${addr.slice(0, head + 2)}…${addr.slice(-tail)}`;
}

function txUrl(txHash: `0x${string}`): string {
  return `${EXPLORER_URL}/tx/${txHash}`;
}

function formatUsdc(microUnits: bigint): string {
  return Number(formatUnits(microUnits, 6)).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

const ZERO_BYTES32 =
  "0x0000000000000000000000000000000000000000000000000000000000000000" as const;

/* ─── Friendly error mapping ─────────────────────────────────────── */

function friendlyError(err: unknown): string {
  if (!err) return "Transaction failed — see console for details.";
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
  return e.shortMessage ?? "Transaction failed — see console for details.";
}

/* ─── Action metadata (per-mode display + verb) ──────────────────── */

interface ActionMeta {
  /** Dialog title (action name) */
  title: string;
  /** One-sentence description shown in the header */
  description: (job: RecentJob) => string;
  /** Icon for the dialog title */
  Icon: typeof Send;
  /** Primary button label (the one that triggers the tx) */
  primaryLabel: string;
  /** Idle-state body — what to tell the user before they click */
  bodyCopy: (job: RecentJob) => string;
  /** Submitting-state copy (while wallet popup is open) */
  submittingCopy: string;
  /** Confirming-state copy (while tx is mining) */
  confirmingCopy: string;
  /** Success-state title */
  successTitle: (job: RecentJob) => string;
  /** Success-state body copy */
  successBody: (job: RecentJob) => string;
}

const ACTION_META: Record<JobAction, ActionMeta> = {
  submit: {
    title: "Submit work",
    description: (job) =>
      `Submit your deliverable for Job #${job.jobId.toString()}. The client will review and either accept (pay you) or reject (refund themselves).`,
    Icon: Send,
    primaryLabel: "Submit",
    bodyCopy: (job) =>
      `Deadline is ${new Date(Number(job.expiredAt) * 1000).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" })} UTC. After it passes, anyone can reclaim the bounty back to the client and your submission no longer matters.`,
    submittingCopy:
      "MetaMask should be prompting you to sign the submit() transaction.",
    confirmingCopy:
      "Submission broadcast — Arc usually confirms in 1–2 seconds.",
    successTitle: (job) => `Submitted to Job #${job.jobId.toString()}`,
    successBody: () =>
      "Your work is now on-chain. The client will see it on the Jobs page and decide whether to accept.",
  },
  complete: {
    title: "Accept and pay",
    description: (job) =>
      `Mark Job #${job.jobId.toString()} as complete and release the bounty to the agent's current owner. This is irreversible.`,
    Icon: CheckCircle2,
    primaryLabel: "Accept and pay",
    bodyCopy: (job) =>
      `${formatUsdc(job.bountyMicro)} USDC will be transferred out of escrow to the wallet that owns agentId #${job.agentId.toString()}. Reputation feedback is written automatically (+100 / "completed").`,
    submittingCopy:
      "MetaMask should be prompting you to sign the complete() transaction.",
    confirmingCopy:
      "Acceptance broadcast — Arc usually confirms in 1–2 seconds.",
    successTitle: (job) => `Job #${job.jobId.toString()} completed`,
    successBody: (job) =>
      `${formatUsdc(job.bountyMicro)} USDC paid to the agent. Reputation feedback written to ERC-8004 ReputationRegistry.`,
  },
  reject: {
    title: "Reject submission",
    description: (job) =>
      `Reject the agent's submission for Job #${job.jobId.toString()} and refund the bounty back to yourself. Reputation feedback is written automatically (−100 / "rejected").`,
    Icon: XCircle,
    primaryLabel: "Reject and refund",
    bodyCopy: (job) =>
      `${formatUsdc(job.bountyMicro)} USDC will be refunded to your wallet. You can optionally attach a short reason — we'll hash it into bytes32 so the full text is verifiable off-chain.`,
    submittingCopy:
      "MetaMask should be prompting you to sign the reject() transaction.",
    confirmingCopy:
      "Rejection broadcast — Arc usually confirms in 1–2 seconds.",
    successTitle: (job) => `Job #${job.jobId.toString()} rejected`,
    successBody: (job) =>
      `${formatUsdc(job.bountyMicro)} USDC refunded. Negative reputation feedback written.`,
  },
  "claim-refund": {
    title: "Claim refund",
    description: (job) =>
      `Reclaim the escrowed bounty for Job #${job.jobId.toString()} back to the client. Only callable after the job's deadline has passed.`,
    Icon: Clock,
    primaryLabel: "Claim refund",
    bodyCopy: (job) =>
      `${formatUsdc(job.bountyMicro)} USDC will return to the client (${truncateAddress(job.client, 6, 4)}). Anyone can call this — if you're not the client yourself, you're just helping them recover their funds (and paying a tiny gas fee for it).`,
    submittingCopy:
      "MetaMask should be prompting you to sign the claimRefund() transaction.",
    confirmingCopy:
      "Refund-claim broadcast — Arc usually confirms in 1–2 seconds.",
    successTitle: (job) => `Job #${job.jobId.toString()} refunded`,
    successBody: (job) =>
      `${formatUsdc(job.bountyMicro)} USDC returned to ${truncateAddress(job.client, 6, 4)}.`,
  },
};

/* ─── Component ─────────────────────────────────────────────────────── */

interface JobActionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  job: RecentJob;
  action: JobAction;
}

export function JobActionDialog({
  open,
  onOpenChange,
  job,
  action,
}: JobActionDialogProps) {
  const { address } = useAccount();
  const chainId = useChainId();
  const { switchChain, isPending: isSwitchPending } = useSwitchChain();
  const queryClient = useQueryClient();

  /* ── Per-action form state. Only submit + reject have inputs. ───── */
  const [deliverableURI, setDeliverableURI] = useState("");
  const [rejectReason, setRejectReason] = useState("");

  /* ── Shared write hook. Single useWriteContract handles all 4
   *    functions; the `functionName` + `args` we pass at call time
   *    discriminates. wagmi resolves the per-call types via the ABI's
   *    function-name literal. */
  const {
    writeContract,
    data: txHash,
    isPending: isWritePending,
    error: writeError,
    reset: resetWrite,
  } = useWriteContract();

  const { data: receipt, error: receiptError } =
    useWaitForTransactionReceipt({
      hash: txHash,
      chainId: CHAIN_ID,
    });

  const onWrongChain = chainId !== CHAIN_ID;

  /* ── URI validation (submit only). For other actions, always ok. */
  const uriValidation =
    action === "submit"
      ? validateDeliverableURI(deliverableURI)
      : { ok: true as const };

  /* ── Derived state. Same shape as register-agent's. Simpler than
   *    Post Job because only ONE tx hook is involved. */
  const state: DialogState = useMemo(() => {
    if (writeError) return { kind: "error", reason: friendlyError(writeError) };
    if (receiptError)
      return { kind: "error", reason: friendlyError(receiptError) };
    if (receipt) {
      if (receipt.status === "reverted") {
        return {
          kind: "error",
          reason: "Transaction reverted onchain. Check Arcscan.",
        };
      }
      return { kind: "success", txHash: receipt.transactionHash };
    }
    if (txHash) return { kind: "confirming", txHash };
    if (isWritePending) return { kind: "submitting" };
    return { kind: "idle" };
  }, [writeError, receiptError, receipt, txHash, isWritePending]);

  const isInFlight =
    state.kind === "submitting" || state.kind === "confirming";

  const canSubmit =
    state.kind === "idle" && !onWrongChain && uriValidation.ok;

  /* ── Reset on dialog open. Clears wagmi tx state + per-action form
   *    inputs. */
  useEffect(() => {
    if (open) {
      resetWrite();
      setDeliverableURI("");
      setRejectReason("");
    }
  }, [open, resetWrite]);

  /* ── Cache invalidation on success. Posts, submits, completions,
   *    rejections, refunds — all of these change JobEscrow's job
   *    structs, so refetching every read-side hook is the right move.
   *    Same prefixes as Register Agent / Post Job. */
  useEffect(() => {
    if (state.kind === "success") {
      queryClient.invalidateQueries({ queryKey: ["readContract"] });
      queryClient.invalidateQueries({ queryKey: ["readContracts"] });
      queryClient.invalidateQueries({ queryKey: ["payment-history"] });
      queryClient.invalidateQueries({ queryKey: ["job-creation-meta"] });
    }
  }, [state.kind, queryClient]);

  /* ── Open-state interception. Same in-flight-blocks-close pattern. */
  const handleOpenChange = (next: boolean) => {
    if (!next && isInFlight) return;
    onOpenChange(next);
  };

  const handleClose = () => onOpenChange(false);
  const handleTryAgain = () => resetWrite();

  /* ── Action handler. Builds (functionName, args) per the `action`
   *    prop and fires writeContract once. */
  const handleAction = () => {
    if (action === "submit") {
      if (!uriValidation.ok) return;
      writeContract({
        address: CONTRACT_ADDRESSES.jobEscrow,
        abi: JOB_ESCROW_ABI,
        functionName: "submit",
        args: [job.jobId, deliverableURI],
        chainId: CHAIN_ID,
      });
      return;
    }
    if (action === "complete") {
      writeContract({
        address: CONTRACT_ADDRESSES.jobEscrow,
        abi: JOB_ESCROW_ABI,
        functionName: "complete",
        args: [job.jobId, ZERO_BYTES32],
        chainId: CHAIN_ID,
      });
      return;
    }
    if (action === "reject") {
      // Empty reason → bytes32(0). Non-empty → keccak256 fingerprint of
      // the UTF-8 bytes. Per the file header: better than truncating
      // the text into a 32-byte ASCII slice.
      const reason =
        rejectReason.trim().length === 0
          ? ZERO_BYTES32
          : keccak256(toBytes(rejectReason));
      writeContract({
        address: CONTRACT_ADDRESSES.jobEscrow,
        abi: JOB_ESCROW_ABI,
        functionName: "reject",
        args: [job.jobId, reason],
        chainId: CHAIN_ID,
      });
      return;
    }
    if (action === "claim-refund") {
      writeContract({
        address: CONTRACT_ADDRESSES.jobEscrow,
        abi: JOB_ESCROW_ABI,
        functionName: "claimRefund",
        args: [job.jobId],
        chainId: CHAIN_ID,
      });
      return;
    }
  };

  const meta = ACTION_META[action];
  const Icon = meta.Icon;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md" showCloseButton={!isInFlight}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Icon className="w-5 h-5 text-accent" />
            {meta.title}
          </DialogTitle>
          <DialogDescription>{meta.description(job)}</DialogDescription>
        </DialogHeader>

        {/* Chain pre-flight */}
        {onWrongChain && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
            <div className="text-xs flex-1">
              <p className="text-destructive font-medium">Wrong network</p>
              <p className="text-muted-foreground mt-0.5">
                You&apos;re on chain {chainId}. Switch to{" "}
                {arcTestnet.name} (chain {CHAIN_ID}).
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

        {/* State-specific body */}
        {state.kind === "idle" && (
          <IdleBody
            action={action}
            job={job}
            meta={meta}
            address={address}
            deliverableURI={deliverableURI}
            onChangeDeliverableURI={setDeliverableURI}
            uriValidation={uriValidation}
            rejectReason={rejectReason}
            onChangeRejectReason={setRejectReason}
          />
        )}
        {state.kind === "submitting" && (
          <SubmittingBody copy={meta.submittingCopy} />
        )}
        {state.kind === "confirming" && (
          <ConfirmingBody copy={meta.confirmingCopy} txHash={state.txHash} />
        )}
        {state.kind === "success" && (
          <SuccessBody
            title={meta.successTitle(job)}
            body={meta.successBody(job)}
            txHash={state.txHash}
          />
        )}
        {state.kind === "error" && <ErrorBody reason={state.reason} />}

        {/* Footer */}
        <DialogFooter className="gap-2">
          {state.kind === "idle" && (
            <>
              <Button variant="ghost" onClick={handleClose}>
                Cancel
              </Button>
              <Button
                onClick={handleAction}
                disabled={!canSubmit}
                className={
                  action === "reject"
                    ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    : "bg-accent text-accent-foreground hover:bg-accent/90"
                }
              >
                {meta.primaryLabel}
              </Button>
            </>
          )}

          {(state.kind === "submitting" || state.kind === "confirming") && (
            <Button disabled className="bg-accent/50 text-accent-foreground">
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              {state.kind === "submitting"
                ? "Confirm in wallet…"
                : "Mining…"}
            </Button>
          )}

          {state.kind === "success" && (
            <>
              <Button variant="ghost" asChild>
                <a
                  href={txUrl(state.txHash)}
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

/* ─── State-body subcomponents ──────────────────────────────────────── */

function IdleBody({
  action,
  job,
  meta,
  address,
  deliverableURI,
  onChangeDeliverableURI,
  uriValidation,
  rejectReason,
  onChangeRejectReason,
}: {
  action: JobAction;
  job: RecentJob;
  meta: ActionMeta;
  address: `0x${string}` | undefined;
  deliverableURI: string;
  onChangeDeliverableURI: (v: string) => void;
  uriValidation: UriValidation;
  rejectReason: string;
  onChangeRejectReason: (v: string) => void;
}) {
  return (
    <div className="space-y-4">
      {/* Job summary card — same compact treatment as the wallet readout
       *  in Register Agent / Post Job, but for the target job. */}
      <div className="rounded-lg border border-border bg-secondary/30 px-3 py-2 space-y-1.5">
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground flex items-center gap-1.5">
            <Bot className="w-3.5 h-3.5" />
            Job #{job.jobId.toString()} · Agent #{job.agentId.toString()}
          </span>
          <span className="font-mono text-foreground">
            {formatUsdc(job.bountyMicro)} USDC
          </span>
        </div>
        {address && (
          <div className="text-xs text-muted-foreground">
            Calling as{" "}
            <code className="font-mono text-foreground">
              {truncateAddress(address, 6, 4)}
            </code>
          </div>
        )}
      </div>

      {/* Body copy — per-action explanation of what this tx does */}
      <p className="text-xs text-muted-foreground">{meta.bodyCopy(job)}</p>

      {/* Action-specific form fields */}
      {action === "submit" && (
        <div className="space-y-1.5">
          <label
            htmlFor="deliverable-uri"
            className="text-xs font-medium text-muted-foreground uppercase tracking-wide block"
          >
            Deliverable URI
          </label>
          <Input
            id="deliverable-uri"
            type="text"
            value={deliverableURI}
            onChange={(e) => onChangeDeliverableURI(e.target.value)}
            placeholder="ipfs://… or https://…"
            // Don't fire the error on initial empty render — same UX as
            // post-job-dialog's bounty field. Only flag once typed.
            aria-invalid={
              deliverableURI.trim().length > 0 && !uriValidation.ok
            }
            className="font-mono text-xs"
          />
          {uriValidation.ok ||
          deliverableURI.trim().length === 0 ? (
            <p className="text-xs text-muted-foreground">
              IPFS or HTTPS link to the work you&apos;re delivering. The
              contract hashes the URI into bytes32 for the JobSubmitted
              event.
            </p>
          ) : (
            <p className="text-xs text-destructive">{uriValidation.reason}</p>
          )}
        </div>
      )}

      {action === "reject" && (
        <div className="space-y-1.5">
          <label
            htmlFor="reject-reason"
            className="text-xs font-medium text-muted-foreground uppercase tracking-wide block"
          >
            Reason (optional)
          </label>
          <Input
            id="reject-reason"
            type="text"
            value={rejectReason}
            onChange={(e) => onChangeRejectReason(e.target.value)}
            placeholder="e.g. delivered URI was unreachable"
            className="text-xs"
          />
          <p className="text-xs text-muted-foreground">
            Optional. We hash your text into bytes32 (keccak256) before
            sending. Leave empty to send bytes32(0).
          </p>
        </div>
      )}
    </div>
  );
}

function SubmittingBody({ copy }: { copy: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-8 gap-3 text-center">
      <Loader2 className="w-8 h-8 text-accent animate-spin" />
      <div>
        <p className="text-sm font-medium text-foreground">
          Confirm in your wallet
        </p>
        <p className="text-xs text-muted-foreground mt-1 max-w-xs">{copy}</p>
      </div>
    </div>
  );
}

function ConfirmingBody({
  copy,
  txHash,
}: {
  copy: string;
  txHash: `0x${string}`;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-8 gap-3 text-center">
      <Loader2 className="w-8 h-8 text-accent animate-spin" />
      <div>
        <p className="text-sm font-medium text-foreground">
          Mining transaction
        </p>
        <p className="text-xs text-muted-foreground mt-1 max-w-xs">{copy}</p>
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
  title,
  body,
  txHash,
}: {
  title: string;
  body: string;
  txHash: `0x${string}`;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-6 gap-3 text-center">
      <div className="w-12 h-12 rounded-full bg-success/10 flex items-center justify-center">
        <CheckCircle2 className="w-7 h-7 text-success" />
      </div>
      <div>
        <p className="text-base font-semibold text-foreground">{title}</p>
        <p className="text-xs text-muted-foreground mt-1 max-w-xs">{body}</p>
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
          Couldn&apos;t complete the action
        </p>
        <p className="text-xs text-muted-foreground mt-1 max-w-xs">
          {reason}
        </p>
      </div>
    </div>
  );
}
