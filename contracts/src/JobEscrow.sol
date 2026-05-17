// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title  IReputationRegistry
 * @notice Minimal local interface for the one ERC-8004 function JobEscrow
 *         calls: `giveFeedback`. Defining this locally (instead of importing
 *         a full ERC-8004 package) keeps the dependency surface small and
 *         pins only the exact behavior we rely on.
 *
 * @dev    Matches the canonical ERC-8004 spec
 *         (https://eips.ethereum.org/EIPS/eip-8004) and was verified against
 *         the deployed Arc testnet contract at
 *         0x8004B663056A597Dffe9eCcC1965A193B7388713 — selector 0x3c036a7e,
 *         permissionlessly callable (no role check).
 */
interface IReputationRegistry {
    function giveFeedback(
        uint256 agentId,
        int128 value,
        uint8 valueDecimals,
        string calldata tag1,
        string calldata tag2,
        string calldata endpoint,
        string calldata feedbackURI,
        bytes32 feedbackHash
    ) external;
}

/**
 * @title  JobEscrow
 * @author Forge (github.com/forgearcdev/forge-arc)
 *
 * @notice Onchain USDC escrow for code-review jobs in the Forge marketplace.
 *         A CLIENT funds a bounty when they create a job and assign it to an
 *         AGENT (identified by their ERC-8004 NFT id). The contract holds the
 *         bounty until the job's lifecycle resolves to one of three terminal
 *         states:
 *
 *         - Completed: client accepted the deliverable. Bounty pays to the
 *           agent's CURRENT NFT owner (which may differ from the submitter
 *           if the NFT was transferred — see `complete` natspec).
 *         - Rejected:  client rejected the deliverable. Bounty refunds to
 *           the client.
 *         - Expired:   no resolution before the deadline. Bounty refunds to
 *           the client. PERMISSIONLESS — anyone may trigger.
 *
 *         When a ReputationRegistry is configured at construction time, the
 *         contract additionally writes ERC-8004 feedback on every Completed
 *         or Rejected transition, tagged `"forge-job"`.
 *
 * @dev    DESIGNED FOR ARC TESTNET (chain id 5042002).
 *         - USDC is both the gas token and the bounty currency. The ERC-20
 *           interface lives at 0x3600000000000000000000000000000000000000.
 *           Despite Arc docs referring to "18 decimals" in a gas-accounting
 *           context, the ERC-20 returns `decimals() = 6`. All bounty amounts
 *           in this contract are 6-decimal USDC.
 *         - ERC-8004 IdentityRegistry is canonical at
 *           0x8004A818BFB912233c491871b3d84c89A494BD9e.
 *         - ERC-8004 ReputationRegistry (optional) at
 *           0x8004B663056A597Dffe9eCcC1965A193B7388713.
 *
 * @dev    LIFECYCLE
 *         ─────────
 *
 *             createJob()        submit()           complete()
 *           ─────────────► Funded ─────────► Submitted ─────────► Completed (TERMINAL)
 *                            │                  │
 *                            │                  ├─ reject() ────► Rejected  (TERMINAL)
 *                            │                  │
 *                            │                  └─ claimRefund() ┐
 *                            │                  (after expiredAt)│
 *                            └─ claimRefund() ──────────────────►┴► Expired  (TERMINAL)
 *                            (after expiredAt)
 *
 *         There is NO pre-submit reject in v1. See `reject` natspec for the
 *         rationale.
 *
 * @dev    OWNERSHIP & UPGRADEABILITY
 *         This contract is intentionally OWNERLESS, NON-UPGRADABLE, and has
 *         NO fees, NO admin role, and NO pause switch. To change behavior,
 *         deploy a new version. Fewer privileges = fewer attack surfaces.
 *
 * @dev    REENTRANCY
 *         All state-mutating external functions use OpenZeppelin's
 *         ReentrancyGuard in addition to strict checks-effects-interactions
 *         ordering. USDC (ERC-20, not ERC-777) does not expose callback hooks
 *         and IdentityRegistry calls are reads, so the practical reentrancy
 *         surface is small — but defense in depth on a contract holding real
 *         bounties is cheap insurance.
 */
contract JobEscrow is ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ════════════════════════════════════════════════════════════════════════
    // ERRORS
    // ════════════════════════════════════════════════════════════════════════

    /// @notice createJob() was called with bounty == 0. A job must escrow value.
    error ZeroBounty();

    /// @notice createJob() was called with a deadline closer than
    ///         MIN_JOB_DURATION from now (or in the past). Prevents griefing
    ///         via "already expired" jobs.
    /// @param  deadline   The deadline argument supplied to createJob.
    /// @param  minAllowed The smallest deadline value that would have been accepted.
    error DeadlineTooClose(uint64 deadline, uint64 minAllowed);

    /// @notice A state-mutating call was made on a job that is not in the
    ///         required state. `expected` is the canonical happy-path state
    ///         for the function that reverted; `actual` is what the job is
    ///         actually in.
    error WrongJobState(uint256 jobId, JobStatus expected, JobStatus actual);

    /// @notice submit() was called by someone other than the current owner of
    ///         the agent's ERC-8004 NFT. Note: "current" is resolved at the
    ///         time of the call, not at createJob.
    error NotAgentOwner(uint256 jobId, uint256 agentId, address caller);

    /// @notice complete() or reject() was called by someone other than the
    ///         job's client (who serves as evaluator in v1).
    error NotClient(uint256 jobId, address caller);

    /// @notice submit() was called at or after the job's deadline. Late
    ///         submissions are forbidden — once expired, the only legal
    ///         action is claimRefund.
    error JobAlreadyExpired(uint256 jobId);

    /// @notice claimRefund() was called before `expiredAt`.
    /// @param  expiredAt   The unix timestamp at which refund becomes legal.
    /// @param  currentTime The block.timestamp at the call site (uint64).
    error NotYetExpired(uint256 jobId, uint64 expiredAt, uint64 currentTime);

    /// @notice submit() was called with a zero-length deliverableURI string.
    error EmptyDeliverable();

    /// @notice Constructor was given address(0) for a REQUIRED address.
    ///         Applies only to `usdc` and `identityRegistry`; the reputation
    ///         registry is allowed to be address(0) (signals "no reputation
    ///         hook").
    error ZeroAddress();

    // ════════════════════════════════════════════════════════════════════════
    // TYPES
    // ════════════════════════════════════════════════════════════════════════

    /**
     * @notice Lifecycle states a Job can be in.
     *
     * - `None`:      Sentinel. Reading an unused jobId returns a zero struct
     *                with status == None, which lets callers distinguish
     *                "no such job" from a real job.
     * - `Funded`:    Initial post-createJob state. Bounty in escrow, awaiting
     *                agent submission.
     * - `Submitted`: Agent submitted a deliverable, awaiting client decision.
     * - `Completed`: TERMINAL. Bounty paid to current NFT owner.
     * - `Rejected`:  TERMINAL. Bounty refunded to client (post-submit reject).
     * - `Expired`:   TERMINAL. Bounty refunded to client (deadline reached
     *                without resolution).
     */
    enum JobStatus {
        None,
        Funded,
        Submitted,
        Completed,
        Rejected,
        Expired
    }

    /**
     * @notice Everything the contract knows about a single job.
     *
     * @dev    FIELD ORDER IS LOAD-BEARING for storage packing. Solidity packs
     *         consecutive fields into the same 32-byte slot when their combined
     *         size allows. Putting the three small fields (`client`, `expiredAt`,
     *         `status`) at the top of the struct packs them into slot 0
     *         (29/32 bytes used), saving one SSTORE per job vs. interleaving
     *         them with the uint256 fields. Don't shuffle this order without
     *         good reason — `test_StorageLayout_JobStructPackingMatchesDesign`
     *         in JobEscrow.t.sol will catch regressions.
     *
     * @param client         Address that funded the job. Also serves as the
     *                       evaluator in v1 — only this address may call
     *                       complete() or reject().
     * @param expiredAt      Unix timestamp at which the job becomes refundable
     *                       by anyone via claimRefund().
     * @param status         Current lifecycle state.
     * @param agentId        ERC-8004 NFT id of the assigned agent. Authorization
     *                       to submit() is DYNAMIC: at submission time the
     *                       contract calls IdentityRegistry.ownerOf(agentId)
     *                       and requires msg.sender == that owner. Payment
     *                       in complete() goes to whoever owns the NFT THEN,
     *                       which may differ from the snapshot at createJob.
     * @param bounty         USDC amount held in escrow for this job (6 decimals).
     * @param deliverableURI IPFS CID, https URL, or similar. Set by submit().
     *                       Empty string before submission and through terminal
     *                       refund states.
     */
    struct Job {
        // Slot 0: client (20B) + expiredAt (8B) + status (1B) = 29/32 bytes packed.
        address client;
        uint64 expiredAt;
        JobStatus status;
        // Slot 1: agentId (full slot).
        uint256 agentId;
        // Slot 2: bounty (full slot).
        uint256 bounty;
        // Slot 3+: dynamic string (length here; data lives at keccak256(slot)).
        string deliverableURI;
    }

    // ════════════════════════════════════════════════════════════════════════
    // CONSTANTS
    // ════════════════════════════════════════════════════════════════════════

    /// @notice Smallest allowed (deadline - block.timestamp) at createJob.
    ///         A job with a deadline closer than this reverts DeadlineTooClose.
    ///         1 hour: short enough for fast iteration, long enough that an
    ///         agent monitoring the chain has time to notice + react.
    uint64 public constant MIN_JOB_DURATION = 1 hours;

    /// @notice tag1 value used when writing to the ERC-8004 ReputationRegistry.
    ///         Identifies feedback as originating from a Forge job (vs. other
    ///         protocols that may also write to the same registry).
    string private constant FEEDBACK_TAG = "forge-job";

    /// @notice Score written to ReputationRegistry on a Completed transition.
    ///         valueDecimals is 0, so this is a flat +100 integer score.
    int128 private constant COMPLETE_FEEDBACK_VALUE = 100;

    /// @notice Score written to ReputationRegistry on a Rejected transition.
    ///         valueDecimals is 0, so this is a flat -100 integer score.
    int128 private constant REJECT_FEEDBACK_VALUE = -100;

    // ════════════════════════════════════════════════════════════════════════
    // IMMUTABLES
    // ════════════════════════════════════════════════════════════════════════

    /// @notice ERC-20 used for bounties. On Arc testnet, USDC at
    ///         0x3600...0000. Immutable — to change tokens, deploy a new
    ///         JobEscrow.
    IERC20 public immutable usdc;

    /// @notice ERC-721 IdentityRegistry from ERC-8004. Resolves agentId
    ///         (tokenId) -> wallet address via `ownerOf`. Immutable.
    IERC721 public immutable identityRegistry;

    /// @notice Optional ERC-8004 ReputationRegistry. If `address(0)` was
    ///         passed at deploy time, feedback writes are skipped silently.
    ///         Useful for local / test deployments where the registry is
    ///         unavailable or undesired.
    IReputationRegistry public immutable reputationRegistry;

    // ════════════════════════════════════════════════════════════════════════
    // STATE
    // ════════════════════════════════════════════════════════════════════════

    /// @notice Monotonic id counter. Starts at 0; the first created job has
    ///         id 1. id 0 is reserved as the "no such job" sentinel (matches
    ///         JobStatus.None for an uninitialized mapping entry).
    uint256 public nextJobId;

    /// @notice Primary state — jobId => Job. Reading an unused id returns a
    ///         zero struct (status == None).
    mapping(uint256 jobId => Job) public jobs;

    // ════════════════════════════════════════════════════════════════════════
    // EVENTS — ERC-8183 standard
    // ════════════════════════════════════════════════════════════════════════

    /**
     * @notice Emitted once per job at the end of createJob().
     * @dev    Signature matches ERC-8183 for indexer compatibility.
     * @param  jobId      Newly minted job id.
     * @param  client     Funder.
     * @param  provider   Snapshot of identityRegistry.ownerOf(agentId) at
     *                    creation time. May differ from the actual submitter
     *                    later if the NFT is transferred.
     * @param  evaluator  In v1 this equals `client` (client is evaluator).
     * @param  expiredAt  Deadline for the job.
     * @param  hook       Always address(0) in v1 (no ERC-8183 hooks).
     */
    event JobCreated(
        uint256 indexed jobId,
        address indexed client,
        address indexed provider,
        address evaluator,
        uint256 expiredAt,
        address hook
    );

    /**
     * @notice Emitted in the same tx as JobCreated, signaling bounty has been
     *         pulled into escrow. Since we merge create + fund into one call,
     *         these events always fire together. Kept separate to match the
     *         ERC-8183 indexer protocol.
     */
    event JobFunded(uint256 indexed jobId, address indexed client, uint256 amount);

    /**
     * @notice Emitted when the agent submits a deliverable.
     * @dev    `deliverable` is keccak256(bytes(deliverableURI)) — a content
     *         commitment that off-chain consumers can verify against the
     *         URI they fetch. The full URI is in DeliverableMetadata.
     */
    event JobSubmitted(uint256 indexed jobId, address indexed provider, bytes32 deliverable);

    /// @notice Emitted on complete(). `reason` is a bytes32 the client may
    ///         set to a hash of an off-chain acceptance note (or 0x0).
    event JobCompleted(uint256 indexed jobId, address indexed evaluator, bytes32 reason);

    /// @notice Emitted on reject(). `reason` is a bytes32 the client may set
    ///         to a hash of an off-chain rejection note (or 0x0).
    event JobRejected(uint256 indexed jobId, address indexed rejector, bytes32 reason);

    /// @notice Emitted on claimRefund() that transitions a job to Expired.
    event JobExpired(uint256 indexed jobId);

    /// @notice Emitted after the USDC transfer to the agent in complete().
    event PaymentReleased(uint256 indexed jobId, address indexed provider, uint256 amount);

    /// @notice Emitted after the USDC refund to the client in reject() or
    ///         claimRefund(). Single event for both refund causes.
    event Refunded(uint256 indexed jobId, address indexed client, uint256 amount);

    // ════════════════════════════════════════════════════════════════════════
    // EVENTS — Forge extensions
    // ════════════════════════════════════════════════════════════════════════

    /// @notice Exposes the binding between a jobId and its assigned agentId.
    ///         ERC-8183's JobCreated only knows about wallet addresses, so we
    ///         emit this separately for Forge-aware indexers.
    event JobAssignedToAgentId(uint256 indexed jobId, uint256 indexed agentId);

    /// @notice Carries the full deliverable URI string. Fires alongside
    ///         JobSubmitted. Kept as a separate event so JobSubmitted stays
    ///         ERC-8183-compatible (which has only bytes32 deliverable).
    event DeliverableMetadata(uint256 indexed jobId, string deliverableURI);

    /// @notice Successful write to the ReputationRegistry. Emitted from
    ///         complete() and reject() when reputationRegistry != address(0)
    ///         AND the giveFeedback call did not revert.
    event FeedbackSubmitted(uint256 indexed agentId, int128 value, string outcomeTag);

    /// @notice ReputationRegistry call was skipped (no registry configured)
    ///         or reverted. The escrow's primary job (releasing funds) still
    ///         succeeded. Indexers can use this to detect missing reputation
    ///         data.
    event FeedbackSkipped(uint256 indexed agentId, int128 value, string outcomeTag, string reasonString);

    // ════════════════════════════════════════════════════════════════════════
    // CONSTRUCTOR
    // ════════════════════════════════════════════════════════════════════════

    /**
     * @notice Wire the contract to its onchain dependencies.
     * @param  _usdc                ERC-20 used for bounties. On Arc, USDC at
     *                              0x3600...0000. Must not be address(0).
     * @param  _identityRegistry    ERC-8004 IdentityRegistry. Used to resolve
     *                              agentId -> wallet address. On Arc,
     *                              0x8004A818BFB912233c491871b3d84c89A494BD9e.
     *                              Must not be address(0).
     * @param  _reputationRegistry  ERC-8004 ReputationRegistry. MAY be
     *                              address(0) — in that case all feedback
     *                              writes are skipped (useful for tests).
     */
    constructor(
        IERC20 _usdc,
        IERC721 _identityRegistry,
        IReputationRegistry _reputationRegistry
    ) {
        if (address(_usdc) == address(0)) revert ZeroAddress();
        if (address(_identityRegistry) == address(0)) revert ZeroAddress();
        // _reputationRegistry IS allowed to be address(0); checked at call site.

        usdc = _usdc;
        identityRegistry = _identityRegistry;
        reputationRegistry = _reputationRegistry;
    }

    // ════════════════════════════════════════════════════════════════════════
    // EXTERNAL — LIFECYCLE
    // ════════════════════════════════════════════════════════════════════════

    /**
     * @notice Create a new job and fund its bounty atomically.
     *
     * @dev    The caller becomes the job's `client` and also serves as the
     *         evaluator in v1 (only address allowed to complete() or reject()).
     *
     * @dev    The caller must have approved `bounty` USDC to this contract
     *         before calling — otherwise the USDC safeTransferFrom will
     *         revert and no job is created.
     *
     * @dev    `agentId` is checked for existence via
     *         identityRegistry.ownerOf(agentId), which reverts if the NFT
     *         has not been minted (or has been burned). That revert
     *         propagates BEFORE any state is written or USDC pulled, so a
     *         createJob for a non-existent agent never escrows funds.
     *
     * @param  agentId  ERC-8004 NFT id of the agent the job is assigned to.
     * @param  bounty   USDC amount (6 decimals) to escrow. Must be > 0.
     * @param  deadline Unix timestamp at/after which claimRefund becomes
     *                  callable by anyone. Must be at least
     *                  `block.timestamp + MIN_JOB_DURATION`.
     * @return jobId    Id assigned to the new job. Starts at 1; id 0 is
     *                  reserved as the "no job" sentinel.
     */
    function createJob(uint256 agentId, uint256 bounty, uint64 deadline)
        external
        nonReentrant
        returns (uint256 jobId)
    {
        // ---- Checks ----
        if (bounty == 0) revert ZeroBounty();
        // block.timestamp manipulation risk is negligible here:
        // ~15s max validator drift vs deadlines measured in hours/days.
        // The forge-lint warning is acknowledged and intentionally not suppressed.
        uint64 minDeadline = uint64(block.timestamp) + MIN_JOB_DURATION;
        if (deadline < minDeadline) revert DeadlineTooClose(deadline, minDeadline);

        // Resolve provider snapshot. Reverts (and aborts this call) if
        // agentId is not minted — we never want to escrow funds for a job
        // pointing at a non-existent agent.
        address providerSnapshot = identityRegistry.ownerOf(agentId);

        // ---- Effects ----
        // unchecked is safe: 2^256 jobIds is unreachable in any realistic
        // chain lifetime, so the increment cannot overflow.
        unchecked {
            jobId = ++nextJobId;
        }
        jobs[jobId] = Job({
            client: msg.sender,
            agentId: agentId,
            bounty: bounty,
            expiredAt: deadline,
            status: JobStatus.Funded,
            deliverableURI: ""
        });

        emit JobCreated(jobId, msg.sender, providerSnapshot, msg.sender, deadline, address(0));
        emit JobAssignedToAgentId(jobId, agentId);
        emit JobFunded(jobId, msg.sender, bounty);

        // ---- Interactions ----
        // Bounty pulled AFTER state writes so a hostile token could not
        // observe the contract mid-update.
        usdc.safeTransferFrom(msg.sender, address(this), bounty);
    }

    /**
     * @notice Agent submits a deliverable. Transitions the job from
     *         `Funded` to `Submitted`.
     *
     * @dev    Authorization is DYNAMIC: msg.sender must equal
     *         identityRegistry.ownerOf(job.agentId) AT THIS MOMENT, not at
     *         createJob time. If the NFT was transferred between creation
     *         and submission, the NEW owner is the legitimate submitter.
     *         This matches ERC-8004's design where the NFT IS the agent's
     *         identity, transferable like any other ERC-721.
     *
     * @dev    Submissions made at or after `expiredAt` revert with
     *         JobAlreadyExpired. Once expired, the only legal action is
     *         claimRefund.
     *
     * @param  jobId          The job to submit to. Must be in Funded state.
     * @param  deliverableURI Pointer to the deliverable (IPFS CID, https URL,
     *                        arweave URI, etc.). Must be non-empty. The hash
     *                        emitted in the standard JobSubmitted event is
     *                        keccak256(bytes(deliverableURI)) so that
     *                        off-chain consumers can verify URI integrity.
     */
    function submit(uint256 jobId, string calldata deliverableURI)
        external
        nonReentrant
    {
        Job storage job = jobs[jobId];

        // ---- Checks ----
        if (job.status != JobStatus.Funded) {
            revert WrongJobState(jobId, JobStatus.Funded, job.status);
        }
        // block.timestamp manipulation risk is negligible here:
        // ~15s max validator drift vs deadlines measured in hours/days.
        // The forge-lint warning is acknowledged and intentionally not suppressed.
        if (block.timestamp >= job.expiredAt) revert JobAlreadyExpired(jobId);
        if (msg.sender != identityRegistry.ownerOf(job.agentId)) {
            revert NotAgentOwner(jobId, job.agentId, msg.sender);
        }
        if (bytes(deliverableURI).length == 0) revert EmptyDeliverable();

        // ---- Effects ----
        job.status = JobStatus.Submitted;
        job.deliverableURI = deliverableURI;

        emit JobSubmitted(jobId, msg.sender, keccak256(bytes(deliverableURI)));
        emit DeliverableMetadata(jobId, deliverableURI);

        // No external value transfer in this function. The IdentityRegistry
        // read above is the only external call.
    }

    /**
     * @notice Client ACCEPTS the submitted deliverable. Transitions the job
     *         from `Submitted` to `Completed` and pays the bounty to the
     *         agent's CURRENT NFT owner.
     *
     * @dev    ────────────────────────────────────────────────────────────
     *         INTENTIONAL BEHAVIOR — AGENT NFT TRANSFER AFTER SUBMIT
     *         ────────────────────────────────────────────────────────────
     *         The payment recipient is resolved as
     *         identityRegistry.ownerOf(job.agentId) AT THE TIME OF THIS
     *         CALL — not the address that submitted, not the snapshot at
     *         job creation. If the agent transferred their ERC-8004 NFT
     *         between submitting and the client calling complete(), the
     *         NEW OWNER receives the bounty. The original submitter does
     *         not.
     *
     *         This is by design, not a bug:
     *           - ERC-8004 treats the NFT as the agent's identity; whoever
     *             holds the NFT IS the agent for all purposes — reputation,
     *             payment, ownership.
     *           - Transferring the NFT is consensual on the seller's side;
     *             the value of any in-flight bounties is presumably priced
     *             into the sale.
     *           - This preserves legitimate use cases like operator handoff,
     *             key rotation, and team transfers.
     *
     *         If you reason about this contract from "wallet" semantics
     *         rather than "NFT" semantics, this can look like a footgun.
     *         It is not. Don't change this without revisiting v1 design
     *         decision #3 (see memory/project_design_decisions_v1.md).
     *
     * @param  jobId  The job to accept. Must be in Submitted state.
     * @param  reason bytes32 the client may use as a hash of an off-chain
     *                acceptance note. Set to 0x0 if not used.
     */
    function complete(uint256 jobId, bytes32 reason)
        external
        nonReentrant
    {
        Job storage job = jobs[jobId];

        // ---- Checks ----
        if (job.status != JobStatus.Submitted) {
            revert WrongJobState(jobId, JobStatus.Submitted, job.status);
        }
        if (msg.sender != job.client) revert NotClient(jobId, msg.sender);

        // Resolve recipient at THIS moment. See @dev above for rationale.
        address recipient = identityRegistry.ownerOf(job.agentId);
        uint256 bounty = job.bounty;
        uint256 agentId = job.agentId;

        // ---- Effects ----
        job.status = JobStatus.Completed;

        emit JobCompleted(jobId, msg.sender, reason);
        emit PaymentReleased(jobId, recipient, bounty);

        // ---- Interactions ----
        usdc.safeTransfer(recipient, bounty);
        _tryGiveFeedback(agentId, COMPLETE_FEEDBACK_VALUE, "completed", reason);
    }

    /**
     * @notice Client REJECTS the submitted deliverable. Transitions the job
     *         from `Submitted` to `Rejected` and refunds the bounty to the
     *         client.
     *
     * @dev    ────────────────────────────────────────────────────────────
     *         WHY PRE-SUBMIT REJECT IS NOT ALLOWED IN v1
     *         ────────────────────────────────────────────────────────────
     *         This function ONLY accepts jobs in the `Submitted` state. A
     *         client who has funded a job CANNOT call reject() while the
     *         job is still `Funded`. Their only path to recover funds
     *         before the agent submits is to wait for `expiredAt` and call
     *         claimRefund (or let someone else do it; the call is
     *         permissionless).
     *
     *         Why this restriction exists:
     *           - The escrow's value proposition to agents is "if I do the
     *             work, I will be evaluated, not arbitrarily cancelled on."
     *           - Pre-submit reject would let clients yank the bounty the
     *             moment they see early signs of agent activity, effectively
     *             extracting free work.
     *           - Tying cancellation to a time-based timeout makes the
     *             contract impartial — neither party can fast-track an
     *             exit; both must respect the agreed deadline.
     *
     *         ERC-8183's reference implementation does allow pre-submit
     *         reject. We deliberately diverge here. v2 may introduce it
     *         behind a flag if usage data warrants.
     *
     * @param  jobId  The job to reject. Must be in Submitted state.
     * @param  reason bytes32 the client may use as a hash of an off-chain
     *                rejection note. Set to 0x0 if not used.
     */
    function reject(uint256 jobId, bytes32 reason)
        external
        nonReentrant
    {
        Job storage job = jobs[jobId];

        // ---- Checks ----
        if (job.status != JobStatus.Submitted) {
            revert WrongJobState(jobId, JobStatus.Submitted, job.status);
        }
        if (msg.sender != job.client) revert NotClient(jobId, msg.sender);

        address client = job.client;
        uint256 bounty = job.bounty;
        uint256 agentId = job.agentId;

        // ---- Effects ----
        job.status = JobStatus.Rejected;

        emit JobRejected(jobId, msg.sender, reason);
        emit Refunded(jobId, client, bounty);

        // ---- Interactions ----
        usdc.safeTransfer(client, bounty);
        _tryGiveFeedback(agentId, REJECT_FEEDBACK_VALUE, "rejected", reason);
    }

    /**
     * @notice Refund the bounty after the deadline has passed.
     *         PERMISSIONLESS — anyone may call this once
     *         `block.timestamp >= job.expiredAt`.
     *
     * @dev    Reachable from BOTH `Funded` and `Submitted`:
     *           - Funded → Expired: agent never submitted within the window.
     *           - Submitted → Expired: client failed to evaluate within the
     *             window. The agent loses the bounty even if their work was
     *             good — this is a known tradeoff in v1.
     *
     * @dev    The permissionless caller bears the gas cost but receives no
     *         reward. They are typically the client, an interested party
     *         (e.g., a UI keeper), or the agent (who has no upside but may
     *         want to clear the slot from their dashboard).
     *
     * @dev    NO reputation write on Expired transitions. Expiry is
     *         ambiguous between "agent didn't deliver" (negative for agent)
     *         and "client didn't evaluate" (no signal for agent). Lumping
     *         both into a single negative feedback would corrupt the
     *         reputation score. v2 may add separate per-cause feedback if
     *         we can disambiguate cheaply.
     *
     * @param  jobId The job to refund. Must be in Funded or Submitted state,
     *               and current time must be >= job.expiredAt.
     */
    function claimRefund(uint256 jobId)
        external
        nonReentrant
    {
        Job storage job = jobs[jobId];

        // ---- Checks ----
        // Allowed from Funded OR Submitted. We use Funded as the "expected"
        // value in the error since it's the canonical-by-volume case.
        if (job.status != JobStatus.Funded && job.status != JobStatus.Submitted) {
            revert WrongJobState(jobId, JobStatus.Funded, job.status);
        }
        // block.timestamp manipulation risk is negligible here:
        // ~15s max validator drift vs deadlines measured in hours/days.
        // The forge-lint warning is acknowledged and intentionally not suppressed.
        if (block.timestamp < job.expiredAt) {
            revert NotYetExpired(jobId, job.expiredAt, uint64(block.timestamp));
        }

        address client = job.client;
        uint256 bounty = job.bounty;

        // ---- Effects ----
        job.status = JobStatus.Expired;

        emit JobExpired(jobId);
        emit Refunded(jobId, client, bounty);

        // ---- Interactions ----
        usdc.safeTransfer(client, bounty);
    }

    // ════════════════════════════════════════════════════════════════════════
    // VIEW
    // ════════════════════════════════════════════════════════════════════════

    /**
     * @notice Return the full Job struct for the given id.
     * @dev    For an unused id, returns a zero struct with status == None.
     *         Callers should check `status` to distinguish "no such job"
     *         from a real job.
     */
    function getJob(uint256 jobId) external view returns (Job memory) {
        return jobs[jobId];
    }

    /**
     * @notice Return whoever currently owns the agent's NFT for this job —
     *         i.e., who would receive payment if complete() were called now.
     * @dev    DEFENSIVE: returns `address(0)` if the agent's NFT cannot be
     *         resolved — either because it was burned, or because `jobId` is
     *         unused (so `agentId == 0`, and `ownerOf(0)` typically reverts).
     *         This makes the function safe for indexers and UIs to call
     *         without their own try/catch wrappers; "no current provider"
     *         is represented as `address(0)`.
     *
     *         The MUTATING functions (`submit`, `complete`) deliberately do
     *         NOT swallow this revert — they need it to enforce authorization
     *         correctness. Only this view function is permissive.
     */
    function getCurrentProvider(uint256 jobId) external view returns (address) {
        try identityRegistry.ownerOf(jobs[jobId].agentId) returns (address owner) {
            return owner;
        } catch {
            return address(0);
        }
    }

    // ════════════════════════════════════════════════════════════════════════
    // INTERNAL
    // ════════════════════════════════════════════════════════════════════════

    /**
     * @notice Write feedback to the ReputationRegistry, but never let a
     *         failure block the escrow's primary job (fund release).
     *
     * @dev    - Skipped silently (with a FeedbackSkipped event) if
     *           reputationRegistry == address(0).
     *         - Wrapped in try/catch so any failure in giveFeedback
     *           (permissioning, gas, panic, etc.) emits FeedbackSkipped
     *           instead of bubbling up.
     *         - The escrow's value is custody of funds, NOT reputation
     *           bookkeeping. A misbehaving registry must never lock funds.
     */
    function _tryGiveFeedback(
        uint256 agentId,
        int128 value,
        string memory outcomeTag,
        bytes32 reason
    ) internal {
        if (address(reputationRegistry) == address(0)) {
            emit FeedbackSkipped(agentId, value, outcomeTag, "registry-not-configured");
            return;
        }

        try reputationRegistry.giveFeedback(
            agentId,
            value,
            0, // valueDecimals: integer score
            FEEDBACK_TAG, // tag1
            outcomeTag, // tag2 (= "completed" or "rejected")
            "", // endpoint
            "", // feedbackURI
            reason // feedbackHash
        ) {
            emit FeedbackSubmitted(agentId, value, outcomeTag);
        } catch {
            emit FeedbackSkipped(agentId, value, outcomeTag, "registry-call-reverted");
        }
    }
}
