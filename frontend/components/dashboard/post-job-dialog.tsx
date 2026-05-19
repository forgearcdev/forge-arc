"use client";

/**
 * Post Job dialog — Phase 5g (live two-tx flow).
 *
 * **Architecture.** Like register-agent-dialog.tsx, the dialog state is
 * *derived* from wagmi hook outputs via `useMemo`. The wrinkle here is
 * there are TWO separate `useWriteContract` hooks — one for USDC.approve
 * and one for JobEscrow.createJob — plus a `useReadContract(USDC.allowance)`
 * that drives the button-label flip between "Approve USDC" and "Post Job".
 *
 * **Two-tx flow with manual chaining:**
 *
 *   1. User fills the form. `useReadContract(allowance)` fires in the
 *      background.
 *   2. If `allowance < bountyMicro`:
 *        → button reads "Approve USDC"
 *        → click fires `writeApprove({ functionName: "approve",
 *           args: [JobEscrow, bountyMicro] })`
 *        → state: approving → confirming_approval → (mined) → back to idle
 *        → useEffect refetches allowance; button label flips to "Post Job"
 *      If `allowance >= bountyMicro`:
 *        → button reads "Post Job"
 *   3. User clicks "Post Job":
 *        → writeCreate({ functionName: "createJob", args })
 *        → state: submitting_create → confirming_create → success
 *      Receipt's logs are parsed for JobCreated; jobId comes from there
 *      (not the function return — same security rationale as Register
 *      Agent's Transfer-log extraction).
 *
 * **Why manual chaining** (no auto second-popup after approve mines):
 * each transaction is an explicit user consent. Auto-prompting the
 * second signature right after the first feels intrusive ("wait, I
 * thought I was just approving?"). One extra click vs. confusion —
 * UX-correct trade for a write-path first-impl.
 *
 * **Known v1 limitation.** If approve mines but createJob later
 * reverts, the USDC stays approved (ERC-20 doesn't auto-revoke). The
 * user can either retry createJob with the same allowance or let it
 * sit (no expiry). Acceptable — Forge's JobEscrow doesn't use this
 * allowance for anything malicious. A future "revoke" UX could be
 * added but is YAGNI for v1.
 *
 * ---
 *
 * **State machine (7 states, manual chaining).**
 *
 *   idle          — form being filled, or back after a successful approval
 *                   (button label is "Approve USDC" if allowance < bounty,
 *                    "Post Job" otherwise)
 *   approving     — USDC.approve wallet popup is open
 *   confirming_approval — approve broadcast, awaiting mine
 *   submitting_create   — createJob wallet popup is open
 *   confirming_create   — createJob broadcast, awaiting mine
 *   success       — JobCreated decoded, jobId in hand
 *   error         — rejection / RPC / revert / no-event-found
 *
 * Two states from the original 9-state spec were absorbed into `idle`:
 *   - `checking_allowance` → wagmi handles loading via the read hook's
 *     `isLoading`. No need for a separate user-facing state — the user
 *     stays on idle while the allowance reads in the background.
 *   - `needs_approval` → same idle UI, different button label. Computed
 *     via `nextStep` derivation (`"approve" | "create" | null`).
 *
 * **Manual chaining decision:** after USDC.approve mines, the dialog
 * returns to idle (not auto-prompts the second signature). The user
 * sees the button label flip from "Approve USDC" to "Post Job" and
 * clicks again. This is one extra click vs. auto-chaining, but it
 * gives explicit consent per transaction — safer for a write-path
 * first-impl. Easy to switch to auto-chain if UX feedback demands it.
 *
 * **Trigger API.** Controlled (open + onOpenChange), same rationale
 * as register-agent-dialog.tsx — see that file's top comment for the
 * RequiresWallet/cloneElement explanation.
 */

import { useEffect, useMemo, useState } from "react";
import {
  useAccount,
  useChainId,
  useReadContract,
  useSwitchChain,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import { useQueryClient } from "@tanstack/react-query";
import { formatUnits, parseEventLogs, parseUnits } from "viem";
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  Coins,
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
import { Skeleton } from "@/components/ui/skeleton";
import { IDENTITY_REGISTRY_ABI } from "@/lib/abi/identity-registry";
import { JOB_ESCROW_ABI } from "@/lib/abi/job-escrow";
import { USDC_ABI } from "@/lib/abi/usdc";
import { CHAIN_ID, CONTRACT_ADDRESSES } from "@/lib/contracts";
import { arcTestnet } from "@/lib/chains";

const EXPLORER_URL = arcTestnet.blockExplorers?.default.url ?? "";

/* ─── Contract constants (mirror src/JobEscrow.sol) ─────────────────── */

/**
 * MIN_JOB_DURATION from JobEscrow.sol line 225: `uint64 public constant
 * MIN_JOB_DURATION = 1 hours;` — the smallest acceptable deadline offset
 * from `block.timestamp`. Hard-coded here to mirror; the constant is a
 * compile-time public on-chain too, so this is a pure UX optimization
 * to fail-fast in the form before submitting. The contract still
 * enforces it server-side regardless.
 */
const MIN_JOB_DURATION_SECONDS = 3600n;

/* ─── State machine ──────────────────────────────────────────────────── */

type DialogState =
  | { kind: "idle" }
  | { kind: "approving" }
  | { kind: "confirming_approval"; txHash: `0x${string}` }
  | { kind: "submitting_create" }
  | { kind: "confirming_create"; txHash: `0x${string}` }
  | { kind: "success"; jobId: bigint; txHash: `0x${string}` }
  | { kind: "error"; reason: string };

/* ─── Form validation ─────────────────────────────────────────────────
 *
 * Each parser takes the raw string from the input and returns either
 * `{ ok: true; value }` with the typed value, or `{ ok: false; reason }`
 * with a user-facing error message. Reusing the same shape across all
 * three fields keeps the render-side branching consistent.
 */
type Parsed<T> = { ok: true; value: T } | { ok: false; reason: string };

/**
 * Agent ID. Free-form numeric input; the underlying type is uint256 so
 * we accept anything BigInt can parse. Rejects 0 (the contract treats 0
 * as "unset") and negative numbers (BigInt would throw).
 */
function parseAgentId(s: string): Parsed<bigint> {
  if (!s.trim()) return { ok: false, reason: "Agent ID required" };
  let n: bigint;
  try {
    n = BigInt(s.trim());
  } catch {
    return { ok: false, reason: "Agent ID must be a whole number" };
  }
  if (n <= 0n) return { ok: false, reason: "Agent ID must be greater than 0" };
  return { ok: true, value: n };
}

/**
 * Bounty USDC. Decimal input — parseUnits converts "1.5" → 1_500_000n
 * (USDC has 6 decimals on its ERC-20 view, see USDC_ABI's header
 * comment for the Arc hybrid-token explanation). Any input that
 * parseUnits can't handle is a format error.
 */
function parseBountyUSDC(s: string): Parsed<bigint> {
  if (!s.trim()) return { ok: false, reason: "Bounty required" };
  // Allow comma OR period as decimal sep for European users.
  const normalized = s.trim().replace(",", ".");
  let micro: bigint;
  try {
    micro = parseUnits(normalized, 6);
  } catch {
    return { ok: false, reason: "Bounty must be a number (e.g. 1.5)" };
  }
  if (micro <= 0n) return { ok: false, reason: "Bounty must be greater than 0" };
  return { ok: true, value: micro };
}

/**
 * Deadline. `datetime-local` input value is "YYYY-MM-DDTHH:MM" in the
 * user's local timezone (no zone suffix). `new Date(s)` parses that as
 * local time; we then convert to unix seconds.
 *
 * Two contract constraints we mirror here for early feedback:
 *   1. Must be in the future (deadline > now)
 *   2. Must be >= now + MIN_JOB_DURATION (= now + 1 hour)
 *
 * The contract enforces these server-side via the DeadlineTooClose
 * revert path, but failing fast in the form is much friendlier UX.
 */
function parseDeadline(s: string): Parsed<bigint> {
  if (!s) return { ok: false, reason: "Deadline required" };
  const ms = Date.parse(s);
  if (Number.isNaN(ms)) {
    return { ok: false, reason: "Invalid date / time" };
  }
  const unixSeconds = BigInt(Math.floor(ms / 1000));
  // Snapshot now exactly once per parse call — borderline-case stability.
  const nowSeconds = BigInt(Math.floor(Date.now() / 1000));
  if (unixSeconds <= nowSeconds) {
    return { ok: false, reason: "Deadline must be in the future" };
  }
  if (unixSeconds < nowSeconds + MIN_JOB_DURATION_SECONDS) {
    return {
      ok: false,
      reason: "Deadline must be at least 1 hour from now",
    };
  }
  return { ok: true, value: unixSeconds };
}

/**
 * Default deadline value to pre-fill the input: now + 24 hours. Helps
 * the user not stare at an empty datetime field wondering what format
 * to type. We compute this fresh each time the dialog opens (via the
 * reset useEffect) so a long-running tab doesn't default to a stale
 * yesterday-evening value.
 */
function defaultDeadlineLocal(): string {
  const target = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${target.getFullYear()}-${pad(target.getMonth() + 1)}-${pad(target.getDate())}` +
    `T${pad(target.getHours())}:${pad(target.getMinutes())}`
  );
}

/* ─── Helpers (mirror register-agent-dialog.tsx) ────────────────────── */

function truncateAddress(addr: string, head = 6, tail = 4): string {
  if (addr.length <= head + tail + 2) return addr;
  return `${addr.slice(0, head + 2)}…${addr.slice(-tail)}`;
}

function jobUrl(jobId: bigint): string {
  // JobEscrow doesn't have a token-page concept; link to the contract
  // address. Refinement in a future phase: deep-link to the specific
  // job via a custom Arcscan filter or our own /job/[id] route.
  return `${EXPLORER_URL}/address/${CONTRACT_ADDRESSES.jobEscrow}`;
}

function txUrl(txHash: `0x${string}`): string {
  return `${EXPLORER_URL}/tx/${txHash}`;
}

/* ─── Friendly error mapping ─────────────────────────────────────────
 *
 * Same surface as register-agent-dialog.tsx. Three explicit cases plus
 * a `shortMessage` fallback. Text-based detection because wagmi v2's
 * error tree (BaseError → ContractFunctionExecutionError →
 * TransactionExecutionError → …) doesn't expose a stable single
 * discriminator across MetaMask / Rabby / etc.
 */
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

/* ─── Component ─────────────────────────────────────────────────────── */

interface PostJobDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function PostJobDialog({ open, onOpenChange }: PostJobDialogProps) {
  const { address } = useAccount();
  const chainId = useChainId();
  const { switchChain, isPending: isSwitchPending } = useSwitchChain();
  const queryClient = useQueryClient();

  /* ── Form state ──────────────────────────────────────────────────── */
  const [agentIdStr, setAgentIdStr] = useState("");
  const [bountyStr, setBountyStr] = useState("");
  const [deadlineStr, setDeadlineStr] = useState("");

  /* ── Validation per field (re-runs every render — cheap, all the
   *    inputs are short strings). */
  const agentIdParsed = parseAgentId(agentIdStr);
  const bountyParsed = parseBountyUSDC(bountyStr);
  const deadlineParsed = parseDeadline(deadlineStr);

  /* ── Pre-flight read #1: USDC balance for the connected wallet.
   *    Fires whenever an address is connected, regardless of form
   *    validity (the user wants to see their balance immediately, even
   *    before filling in a bounty). */
  const balanceRead = useReadContract({
    address: CONTRACT_ADDRESSES.usdc,
    abi: USDC_ABI,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    chainId: CHAIN_ID,
    query: { enabled: !!address },
  });
  const balance: bigint | undefined = balanceRead.data;

  /* ── Pre-flight read #3: current USDC allowance from the connected
   *    wallet to JobEscrow. This drives the button-label flip — if
   *    `allowance >= bountyMicro` we skip directly to "Post Job",
   *    otherwise the first step is "Approve USDC". Refetched after
   *    USDC.approve mines so the label flips automatically without
   *    forcing the user to close + reopen the dialog. */
  const allowanceRead = useReadContract({
    address: CONTRACT_ADDRESSES.usdc,
    abi: USDC_ABI,
    functionName: "allowance",
    args: address
      ? [address, CONTRACT_ADDRESSES.jobEscrow]
      : undefined,
    chainId: CHAIN_ID,
    query: { enabled: !!address },
  });
  const allowance: bigint | undefined = allowanceRead.data;
  const { refetch: refetchAllowance } = allowanceRead;

  /* ── Tx hook #1: USDC.approve. Triggered when the user clicks
   *    "Approve USDC" (i.e. when nextStep === "approve" below). */
  const {
    writeContract: writeApprove,
    data: approveTxHash,
    isPending: isApprovePending,
    error: approveError,
    reset: resetApprove,
  } = useWriteContract();
  const { data: approveReceipt, error: approveReceiptError } =
    useWaitForTransactionReceipt({
      hash: approveTxHash,
      chainId: CHAIN_ID,
    });

  /* ── Tx hook #2: JobEscrow.createJob. Triggered when nextStep ===
   *    "create" and the user clicks "Post Job". Separate hook from
   *    approve so each tx has its own data / isPending / error — wagmi
   *    overwrites a single hook's `data` field on each call, which
   *    would lose the approve tx hash mid-flow. */
  const {
    writeContract: writeCreate,
    data: createTxHash,
    isPending: isCreatePending,
    error: createError,
    reset: resetCreate,
  } = useWriteContract();
  const { data: createReceipt, error: createReceiptError } =
    useWaitForTransactionReceipt({
      hash: createTxHash,
      chainId: CHAIN_ID,
    });

  /* ── Pre-flight read #2: agent existence via IdentityRegistry.ownerOf.
   *    Only fires when agentId parses successfully — no point pinging
   *    the chain for malformed input. ownerOf REVERTS for non-existent
   *    tokens (ERC721NonexistentToken), which wagmi surfaces as
   *    `isError: true`. We treat that as "agent not found" rather than
   *    a transient RPC error — see notes on retry below.
   *
   *    `retry: false` keeps wagmi from re-trying the revert (a real RPC
   *    fail would surface the same way, but trying again wouldn't help
   *    for a true non-existent token). If we ever need to distinguish
   *    revert-vs-network, we'd inspect `agentOwnerRead.error` for the
   *    ContractFunctionExecutionError name. */
  const agentOwnerRead = useReadContract({
    address: CONTRACT_ADDRESSES.identityRegistry,
    abi: IDENTITY_REGISTRY_ABI,
    functionName: "ownerOf",
    args: agentIdParsed.ok ? [agentIdParsed.value] : undefined,
    chainId: CHAIN_ID,
    query: {
      enabled: agentIdParsed.ok,
      retry: false,
    },
  });

  /* ── Derived: agent existence status as a discriminated state ──── */
  type AgentStatus =
    | { kind: "empty" } // no agentId entered yet
    | { kind: "invalid"; reason: string } // agentId fails parsing
    | { kind: "loading" } // ownerOf in flight
    | { kind: "not_found" } // ownerOf reverted
    | { kind: "exists"; owner: `0x${string}` };

  const agentStatus: AgentStatus = (() => {
    if (!agentIdStr.trim()) return { kind: "empty" };
    if (!agentIdParsed.ok)
      return { kind: "invalid", reason: agentIdParsed.reason };
    if (agentOwnerRead.isLoading) return { kind: "loading" };
    if (agentOwnerRead.isError) return { kind: "not_found" };
    if (agentOwnerRead.data) {
      return { kind: "exists", owner: agentOwnerRead.data as `0x${string}` };
    }
    return { kind: "loading" };
  })();

  /* ── Derived: balance sufficiency ─────────────────────────────────── */
  const hasSufficientBalance =
    bountyParsed.ok && balance != null && balance >= bountyParsed.value;

  /* ── Derived: chain pre-flight ────────────────────────────────────── */
  const onWrongChain = chainId !== CHAIN_ID;

  /* ── Derived dialog state. Same pattern as register-agent-dialog.tsx
   *    but with TWO tx hooks feeding in. Order of checks matters:
   *
   *    1. createJob errors / receipt (later in the flow, takes priority
   *       over approve state — if create has finished, approve is
   *       already-resolved history).
   *    2. createJob mid-flight (submitting / confirming).
   *    3. approve errors / receipt (errors only — successful receipts
   *       fall through to idle since they don't have their own state).
   *    4. approve mid-flight.
   *    5. idle (default).
   *
   *    A successful approve receipt doesn't get its own state kind —
   *    we go back to idle, and the allowance refetch makes the button
   *    flip from "Approve USDC" to "Post Job". */
  const state: DialogState = useMemo(() => {
    // ── createJob terminal states ─────────────────────────────────
    if (createError) {
      return { kind: "error", reason: friendlyError(createError) };
    }
    if (createReceiptError) {
      return { kind: "error", reason: friendlyError(createReceiptError) };
    }
    if (createReceipt) {
      if (createReceipt.status === "reverted") {
        return {
          kind: "error",
          reason: "Transaction reverted onchain — job not created.",
        };
      }
      // Parse JobCreated event for the new jobId. Same reasoning as
      // Register Agent: don't trust the function return value, the
      // chain log is authoritative. createJob emits THREE events
      // (JobCreated, JobAssignedToAgentId, JobFunded — see
      // contracts/src/JobEscrow.sol lines 447-449); we filter by
      // eventName to pick just JobCreated.
      const decoded = parseEventLogs({
        abi: JOB_ESCROW_ABI,
        logs: createReceipt.logs,
        eventName: "JobCreated",
      });
      const createdLog = decoded.find(
        (l) =>
          l.address.toLowerCase() ===
          CONTRACT_ADDRESSES.jobEscrow.toLowerCase(),
      );
      if (!createdLog) {
        return {
          kind: "error",
          reason:
            "Job tx succeeded but no JobCreated event found in receipt. Check Arcscan.",
        };
      }
      return {
        kind: "success",
        jobId: createdLog.args.jobId,
        txHash: createReceipt.transactionHash,
      };
    }
    // ── createJob mid-flight ──────────────────────────────────────
    if (createTxHash) return { kind: "confirming_create", txHash: createTxHash };
    if (isCreatePending) return { kind: "submitting_create" };
    // ── approve terminal states (errors only) ─────────────────────
    if (approveError) {
      return { kind: "error", reason: friendlyError(approveError) };
    }
    if (approveReceiptError) {
      return { kind: "error", reason: friendlyError(approveReceiptError) };
    }
    if (approveReceipt && approveReceipt.status === "reverted") {
      return {
        kind: "error",
        reason: "Approval reverted onchain. Try again.",
      };
    }
    // approveReceipt success → fall through to idle (allowance refetch
    // will pick up the new value and the button label will flip).
    // ── approve mid-flight ─────────────────────────────────────────
    // approveTxHash persists after the receipt arrives, so we must also
    // require approveReceipt to be undefined — otherwise we return to
    // confirming_approval forever post-success. See 2026-05-19 bug.
    if (approveTxHash && !approveReceipt) {
      return { kind: "confirming_approval", txHash: approveTxHash };
    }
    if (isApprovePending) return { kind: "approving" };
    // ── default ────────────────────────────────────────────────────
    return { kind: "idle" };
  }, [
    createError,
    createReceiptError,
    createReceipt,
    createTxHash,
    isCreatePending,
    approveError,
    approveReceiptError,
    approveReceipt,
    approveTxHash,
    isApprovePending,
  ]);

  /* ── nextStep: "approve" | "create" | null. Determines the button
   *    label / which writeContract to fire when the user clicks. Only
   *    meaningful when state.kind === "idle"; the footer for other
   *    states renders mid-flight spinners or success/error CTAs.
   *
   *    Null means we're not ready (form invalid OR allowance still
   *    loading OR wrong chain). The button stays disabled.
   *
   *    Important: allowance can be 0n on a fresh wallet — we must
   *    explicitly handle `allowance != null`, not `allowance != null
   *    && allowance > 0n`, since 0 is a perfectly valid "no allowance"
   *    that means "approve first". */
  const nextStep: "approve" | "create" | null = (() => {
    if (state.kind !== "idle") return null;
    if (onWrongChain) return null;
    if (!agentIdParsed.ok || !bountyParsed.ok || !deadlineParsed.ok) {
      return null;
    }
    if (agentStatus.kind !== "exists") return null;
    if (!hasSufficientBalance) return null;
    if (allowance == null) return null; // allowance read still loading
    return allowance < bountyParsed.value ? "approve" : "create";
  })();

  const canSubmit = nextStep !== null;

  /* ── Action handlers ─────────────────────────────────────────────── */

  const handlePostJob = () => {
    if (!agentIdParsed.ok || !bountyParsed.ok || !deadlineParsed.ok) return;
    if (nextStep === "approve") {
      // USDC.approve(JobEscrow, bountyMicro). We approve exact-bounty,
      // not MaxUint256, per the security decision codified in
      // lib/abi/usdc.ts.
      writeApprove({
        address: CONTRACT_ADDRESSES.usdc,
        abi: USDC_ABI,
        functionName: "approve",
        args: [CONTRACT_ADDRESSES.jobEscrow, bountyParsed.value],
        chainId: CHAIN_ID,
      });
      return;
    }
    if (nextStep === "create") {
      // JobEscrow.createJob(agentId, bounty, deadline). deadline is
      // uint64 in the contract but bigint here — wagmi handles the
      // narrowing.
      writeCreate({
        address: CONTRACT_ADDRESSES.jobEscrow,
        abi: JOB_ESCROW_ABI,
        functionName: "createJob",
        args: [
          agentIdParsed.value,
          bountyParsed.value,
          deadlineParsed.value,
        ],
        chainId: CHAIN_ID,
      });
      return;
    }
  };

  const isInFlight =
    state.kind === "approving" ||
    state.kind === "confirming_approval" ||
    state.kind === "submitting_create" ||
    state.kind === "confirming_create";

  const handleOpenChange = (next: boolean) => {
    if (!next && isInFlight) return;
    onOpenChange(next);
  };

  const handleClose = () => onOpenChange(false);

  // "Try again" from error state: reset BOTH wagmi states. We don't
  // know whether the error came from approve or create, and resetting
  // both is harmless — the one that wasn't called is a no-op. The
  // derived state recomputes back to idle.
  const handleTryAgain = () => {
    resetApprove();
    resetCreate();
  };

  /* ── Reset on dialog open. Clears stale form values + wagmi tx state
   *    + recomputes the deadline default. Also refetches allowance in
   *    case the user previously approved (e.g. for a different agent
   *    in a prior dialog session) and the cache is stale. */
  useEffect(() => {
    if (open) {
      resetApprove();
      resetCreate();
      setAgentIdStr("");
      setBountyStr("");
      setDeadlineStr(defaultDeadlineLocal());
      // Allowance refetch is safe even if it's already fresh — wagmi
      // dedupes simultaneous reads.
      refetchAllowance();
    }
  }, [open, resetApprove, resetCreate, refetchAllowance]);

  /* ── Refetch allowance after approve mines. Without this, the button
   *    label would stay "Approve USDC" until the user manually closed +
   *    reopened the dialog (which triggers the reset above). The
   *    cache-invalidation `useEffect` lower down handles the broader
   *    dashboard refresh; this hook specifically updates OUR allowance
   *    read so `nextStep` flips. */
  useEffect(() => {
    if (approveReceipt && approveReceipt.status === "success") {
      refetchAllowance();
    }
  }, [approveReceipt, refetchAllowance]);

  /* ── Cache invalidation on createJob success. Same query-key prefixes
   *    as register-agent-dialog.tsx — `readContract` / `readContracts`
   *    matches every useReadContract / useReadContracts across the app,
   *    so useJobStats (the Jobs table source-of-truth), useAgents'
   *    ownerOf reads, and the Overview's stats card refetches all pick
   *    up the new job. The custom-keyed log scans (`payment-history`,
   *    `job-creation-meta`) also invalidate so useRecentJobs's per-job
   *    timestamp map gets re-scanned with the new JobCreated log.
   *
   *    Unlike Register Agent's caveat (fresh mints stay hidden), posted
   *    jobs DO appear in the Jobs / Recent Jobs / Overview tables
   *    immediately — useJobStats iterates JobEscrow.getJob(i) for every
   *    i in [1, nextJobId], so the new job is discovered automatically. */
  useEffect(() => {
    if (state.kind === "success") {
      queryClient.invalidateQueries({ queryKey: ["readContract"] });
      queryClient.invalidateQueries({ queryKey: ["readContracts"] });
      queryClient.invalidateQueries({ queryKey: ["payment-history"] });
      queryClient.invalidateQueries({ queryKey: ["job-creation-meta"] });
    }
  }, [state.kind, queryClient]);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md" showCloseButton={!isInFlight}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Coins className="w-5 h-5 text-accent" />
            Post Job
          </DialogTitle>
          <DialogDescription>
            Fund a USDC bounty in escrow. The agent you pick can submit
            work before the deadline; you approve or reject on review.
          </DialogDescription>
        </DialogHeader>

        {/* Chain pre-flight */}
        {onWrongChain && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
            <div className="text-xs flex-1">
              <p className="text-destructive font-medium">Wrong network</p>
              <p className="text-muted-foreground mt-0.5">
                You&apos;re on chain {chainId}. Switch to {arcTestnet.name}{" "}
                (chain {CHAIN_ID}) to post a job.
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
            address={address}
            balance={balance}
            balanceLoading={balanceRead.isLoading}
            agentIdStr={agentIdStr}
            onChangeAgentId={setAgentIdStr}
            agentStatus={agentStatus}
            bountyStr={bountyStr}
            onChangeBounty={setBountyStr}
            bountyParsed={bountyParsed}
            hasSufficientBalance={hasSufficientBalance}
            deadlineStr={deadlineStr}
            onChangeDeadline={setDeadlineStr}
            deadlineParsed={deadlineParsed}
          />
        )}
        {state.kind === "approving" && <ApprovingBody />}
        {state.kind === "confirming_approval" && (
          <ConfirmingApprovalBody txHash={state.txHash} />
        )}
        {state.kind === "submitting_create" && <SubmittingCreateBody />}
        {state.kind === "confirming_create" && (
          <ConfirmingCreateBody txHash={state.txHash} />
        )}
        {state.kind === "success" && (
          <SuccessBody jobId={state.jobId} txHash={state.txHash} />
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
                onClick={handlePostJob}
                disabled={!canSubmit}
                className="bg-accent text-accent-foreground hover:bg-accent/90"
              >
                {/* Label flips based on allowance vs bounty. When the
                 *  allowance read is still loading or any guard above
                 *  hasn't passed, `nextStep` is null and the button is
                 *  disabled — we still need to render *something*, so
                 *  default to "Post Job" as the meaningful end-state
                 *  label. */}
                {nextStep === "approve" ? "Approve USDC" : "Post Job"}
              </Button>
            </>
          )}

          {(state.kind === "approving" ||
            state.kind === "confirming_approval") && (
            <Button disabled className="bg-accent/50 text-accent-foreground">
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              {state.kind === "approving"
                ? "Approve in wallet…"
                : "Approving…"}
            </Button>
          )}

          {(state.kind === "submitting_create" ||
            state.kind === "confirming_create") && (
            <Button disabled className="bg-accent/50 text-accent-foreground">
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              {state.kind === "submitting_create"
                ? "Confirm in wallet…"
                : "Mining…"}
            </Button>
          )}

          {state.kind === "success" && (
            <>
              <Button variant="ghost" asChild>
                <a
                  href={jobUrl(state.jobId)}
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

type AgentStatus =
  | { kind: "empty" }
  | { kind: "invalid"; reason: string }
  | { kind: "loading" }
  | { kind: "not_found" }
  | { kind: "exists"; owner: `0x${string}` };

function IdleBody({
  address,
  balance,
  balanceLoading,
  agentIdStr,
  onChangeAgentId,
  agentStatus,
  bountyStr,
  onChangeBounty,
  bountyParsed,
  hasSufficientBalance,
  deadlineStr,
  onChangeDeadline,
  deadlineParsed,
}: {
  address: `0x${string}` | undefined;
  balance: bigint | undefined;
  balanceLoading: boolean;
  agentIdStr: string;
  onChangeAgentId: (v: string) => void;
  agentStatus: AgentStatus;
  bountyStr: string;
  onChangeBounty: (v: string) => void;
  bountyParsed: Parsed<bigint>;
  hasSufficientBalance: boolean;
  deadlineStr: string;
  onChangeDeadline: (v: string) => void;
  deadlineParsed: Parsed<bigint>;
}) {
  return (
    <div className="space-y-4">
      {/* Wallet + balance readout */}
      {address && (
        <div className="flex items-center justify-between rounded-lg border border-border bg-secondary/30 px-3 py-2">
          <span className="text-xs text-muted-foreground flex items-center gap-1.5">
            <Wallet className="w-3.5 h-3.5" />
            Paying from
          </span>
          <span className="flex items-center gap-1">
            <code className="font-mono text-xs text-foreground">
              {truncateAddress(address, 6, 4)}
            </code>
            <CopyButton value={address} label="Copy wallet address" />
          </span>
        </div>
      )}

      {/* ── Agent ID field ──────────────────────────────────────── */}
      <div className="space-y-1.5">
        <label
          htmlFor="agent-id"
          className="text-xs font-medium text-muted-foreground uppercase tracking-wide block"
        >
          Agent ID
        </label>
        <Input
          id="agent-id"
          type="text"
          inputMode="numeric"
          value={agentIdStr}
          onChange={(e) => onChangeAgentId(e.target.value)}
          placeholder="e.g. 14776"
          aria-invalid={
            agentStatus.kind === "invalid" || agentStatus.kind === "not_found"
          }
          className="font-mono text-xs"
        />
        <AgentStatusLine status={agentStatus} />
      </div>

      {/* ── Bounty field ────────────────────────────────────────── */}
      <div className="space-y-1.5">
        <label
          htmlFor="bounty-usdc"
          className="text-xs font-medium text-muted-foreground uppercase tracking-wide block"
        >
          Bounty (USDC)
        </label>
        <div className="relative">
          <Input
            id="bounty-usdc"
            type="text"
            inputMode="decimal"
            value={bountyStr}
            onChange={(e) => onChangeBounty(e.target.value)}
            placeholder="1.00"
            // Don't paint the input red on initial empty state — only flag
            // it once the user has typed something invalid OR an amount
            // that exceeds the wallet's balance. Same UX motivation as
            // BountyStatusLine's empty-state branch.
            aria-invalid={
              bountyStr.trim().length > 0 &&
              (!bountyParsed.ok || !hasSufficientBalance)
            }
            className="font-mono text-xs pr-14"
          />
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground font-mono pointer-events-none">
            USDC
          </span>
        </div>
        <BountyStatusLine
          bountyStr={bountyStr}
          parsed={bountyParsed}
          balance={balance}
          balanceLoading={balanceLoading}
          hasSufficientBalance={hasSufficientBalance}
        />
      </div>

      {/* ── Deadline field ──────────────────────────────────────── */}
      <div className="space-y-1.5">
        <label
          htmlFor="deadline"
          className="text-xs font-medium text-muted-foreground uppercase tracking-wide block"
        >
          Deadline
        </label>
        <Input
          id="deadline"
          type="datetime-local"
          value={deadlineStr}
          onChange={(e) => onChangeDeadline(e.target.value)}
          aria-invalid={!deadlineParsed.ok}
          className="font-mono text-xs"
        />
        {deadlineParsed.ok ? (
          <p className="text-xs text-muted-foreground">
            Agent must submit before this time. Contract enforces a 1 hour
            minimum window.
          </p>
        ) : (
          <p className="text-xs text-destructive">{deadlineParsed.reason}</p>
        )}
      </div>
    </div>
  );
}

function AgentStatusLine({ status }: { status: AgentStatus }) {
  // NOTE: wrapper is <div> not <p> because the "loading" branch contains
  // a <Skeleton> (which renders as <div>), and a <div> inside a <p> is
  // invalid HTML — React 19 logs a hydration warning. Consistency
  // requires the other branches use <div> too, even though they only
  // contain phrasing content.
  switch (status.kind) {
    case "empty":
      return (
        <div className="text-xs text-muted-foreground">
          The agent must already exist on the ERC-8004 IdentityRegistry.
        </div>
      );
    case "invalid":
      return <div className="text-xs text-destructive">{status.reason}</div>;
    case "loading":
      return (
        <div className="text-xs text-muted-foreground flex items-center gap-1.5">
          <Skeleton className="h-3 w-3 rounded-full bg-secondary inline-block" />
          Looking up agent…
        </div>
      );
    case "not_found":
      return (
        <div className="text-xs text-destructive">
          Agent not found on IdentityRegistry. Check the ID on Arcscan, then
          retype.
        </div>
      );
    case "exists":
      return (
        <div className="text-xs text-success flex items-center gap-1.5">
          <CheckCircle2 className="w-3 h-3" />
          Agent exists — owned by{" "}
          <code className="font-mono">{truncateAddress(status.owner, 6, 4)}</code>
        </div>
      );
  }
}

function BountyStatusLine({
  bountyStr,
  parsed,
  balance,
  balanceLoading,
  hasSufficientBalance,
}: {
  bountyStr: string;
  parsed: Parsed<bigint>;
  balance: bigint | undefined;
  balanceLoading: boolean;
  hasSufficientBalance: boolean;
}) {
  // NOTE: all wrappers below are <div>, not <p>. The balanceLoading
  // branch renders <Skeleton> (a <div>); <div> inside <p> is invalid
  // HTML and produces a hydration mismatch under React 19. Using <div>
  // everywhere keeps the DOM legal regardless of which branch fires.

  // Balance line (always shown if wallet is connected). Color and text
  // change based on whether the entered bounty exceeds available USDC.
  const balanceLine = balanceLoading ? (
    <Skeleton className="h-3 w-32 bg-secondary inline-block" />
  ) : balance != null ? (
    <span
      className={
        parsed.ok && !hasSufficientBalance
          ? "text-destructive"
          : "text-muted-foreground"
      }
    >
      You have {formatUnits(balance, 6)} USDC
    </span>
  ) : null;

  // Don't yell "Bounty required" the instant the dialog opens — show the
  // balance line as a friendly prompt instead. The Post Job button being
  // disabled is sufficient negative feedback when the field is untouched.
  // Only surface the parse error once the user has TYPED something that
  // doesn't parse cleanly.
  const isEmpty = bountyStr.trim().length === 0;

  if (!parsed.ok && !isEmpty) {
    return (
      <div className="text-xs space-y-0.5">
        <div className="text-destructive">{parsed.reason}</div>
        {balanceLine && <div className="text-xs">{balanceLine}</div>}
      </div>
    );
  }

  if (parsed.ok && !hasSufficientBalance && balance != null) {
    return (
      <div className="text-xs text-destructive">
        Insufficient USDC — {balanceLine}
      </div>
    );
  }

  return <div className="text-xs">{balanceLine}</div>;
}

function ApprovingBody() {
  return (
    <div className="flex flex-col items-center justify-center py-8 gap-3 text-center">
      <Loader2 className="w-8 h-8 text-accent animate-spin" />
      <div>
        <p className="text-sm font-medium text-foreground">
          Approve USDC in your wallet
        </p>
        <p className="text-xs text-muted-foreground mt-1 max-w-xs">
          MetaMask should be prompting you to authorize JobEscrow to pull the
          bounty. This is step 1 of 2.
        </p>
      </div>
    </div>
  );
}

function ConfirmingApprovalBody({ txHash }: { txHash: `0x${string}` }) {
  return (
    <div className="flex flex-col items-center justify-center py-8 gap-3 text-center">
      <Loader2 className="w-8 h-8 text-accent animate-spin" />
      <div>
        <p className="text-sm font-medium text-foreground">
          Confirming approval
        </p>
        <p className="text-xs text-muted-foreground mt-1 max-w-xs">
          Approval transaction broadcast — Arc usually confirms in 1–2
          seconds. Step 1 of 2.
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

function SubmittingCreateBody() {
  return (
    <div className="flex flex-col items-center justify-center py-8 gap-3 text-center">
      <Loader2 className="w-8 h-8 text-accent animate-spin" />
      <div>
        <p className="text-sm font-medium text-foreground">
          Confirm job creation
        </p>
        <p className="text-xs text-muted-foreground mt-1 max-w-xs">
          MetaMask should be prompting you to sign the createJob
          transaction. This is step 2 of 2.
        </p>
      </div>
    </div>
  );
}

function ConfirmingCreateBody({ txHash }: { txHash: `0x${string}` }) {
  return (
    <div className="flex flex-col items-center justify-center py-8 gap-3 text-center">
      <Loader2 className="w-8 h-8 text-accent animate-spin" />
      <div>
        <p className="text-sm font-medium text-foreground">
          Mining your job
        </p>
        <p className="text-xs text-muted-foreground mt-1 max-w-xs">
          Job-creation transaction broadcast — Arc usually confirms in 1–2
          seconds.
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
  jobId,
  txHash,
}: {
  jobId: bigint;
  txHash: `0x${string}`;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-6 gap-3 text-center">
      <div className="w-12 h-12 rounded-full bg-success/10 flex items-center justify-center">
        <CheckCircle2 className="w-7 h-7 text-success" />
      </div>
      <div>
        <p className="text-base font-semibold text-foreground">
          Job #{jobId.toString()} posted!
        </p>
        {/* Unlike Register Agent, posted jobs DO appear in our tables
         *  immediately on cache invalidation — useJobStats / useRecentJobs
         *  derive directly from JobEscrow.getJob iteration. No "won't
         *  appear until X" caveat needed here. */}
        <p className="text-xs text-muted-foreground mt-1 max-w-xs">
          Your bounty is in escrow. The agent can submit work before the
          deadline — you&apos;ll approve or reject from the Jobs table.
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
          Couldn&apos;t post the job
        </p>
        <p className="text-xs text-muted-foreground mt-1 max-w-xs">
          {reason}
        </p>
      </div>
    </div>
  );
}
