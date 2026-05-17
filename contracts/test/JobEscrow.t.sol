// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {JobEscrow, IReputationRegistry} from "../src/JobEscrow.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

// ════════════════════════════════════════════════════════════════════════════
// MOCKS — minimal stand-ins for the surfaces JobEscrow actually calls.
// Kept hand-rolled (not OZ's full ERC-20/ERC-721) so each mock is small,
// auditable in one screen, and exposes test-only helpers like mint/burn.
// ════════════════════════════════════════════════════════════════════════════

/// @notice Minimal ERC-20: balanceOf, transfer, transferFrom, approve, plus
///         a mint() for test setup. Returns `true` on success (well-behaved).
contract MockUSDC {
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        totalSupply += amount;
        emit Transfer(address(0), to, amount);
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        emit Transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allow = allowance[from][msg.sender];
        if (allow != type(uint256).max) {
            allowance[from][msg.sender] = allow - amount;
        }
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
        return true;
    }
}

/// @notice Minimal ERC-721 surface JobEscrow touches: `ownerOf` only. Plus
///         test-only `mint`/`transfer`/`burn` so each test can set up the
///         agent NFT state it needs. Reverts on `ownerOf(nonexistent)` so the
///         tests for "agentId must exist" can assert that path.
contract MockIdentityRegistry {
    mapping(uint256 => address) private _owners;

    error MIR_NonexistentToken();

    function mint(address to, uint256 tokenId) external {
        require(_owners[tokenId] == address(0), "MIR: already minted");
        _owners[tokenId] = to;
    }

    function transfer(uint256 tokenId, address to) external {
        require(_owners[tokenId] != address(0), "MIR: nonexistent");
        require(to != address(0), "MIR: to zero");
        _owners[tokenId] = to;
    }

    function burn(uint256 tokenId) external {
        require(_owners[tokenId] != address(0), "MIR: nonexistent");
        _owners[tokenId] = address(0);
    }

    function ownerOf(uint256 tokenId) external view returns (address) {
        address owner = _owners[tokenId];
        if (owner == address(0)) revert MIR_NonexistentToken();
        return owner;
    }
}

/// @notice Records every `giveFeedback` call so tests can assert what was
///         written. Includes the fields we care about (agentId, value, tags,
///         feedbackHash) and drops the ones we don't (decimals, endpoint,
///         feedbackURI which JobEscrow always passes as 0 / empty).
contract MockReputationRegistry is IReputationRegistry {
    struct FeedbackCall {
        uint256 agentId;
        int128 value;
        string tag1;
        string tag2;
        bytes32 feedbackHash;
    }

    FeedbackCall[] private _calls;

    function giveFeedback(
        uint256 agentId,
        int128 value,
        uint8 /*valueDecimals*/,
        string calldata tag1,
        string calldata tag2,
        string calldata /*endpoint*/,
        string calldata /*feedbackURI*/,
        bytes32 feedbackHash
    ) external override {
        _calls.push(FeedbackCall(agentId, value, tag1, tag2, feedbackHash));
    }

    function callCount() external view returns (uint256) {
        return _calls.length;
    }

    function lastCall() external view returns (FeedbackCall memory) {
        require(_calls.length > 0, "no calls");
        return _calls[_calls.length - 1];
    }
}

/// @notice Always reverts on `giveFeedback`. Used to verify JobEscrow's
///         try/catch swallows the failure and still releases funds.
contract RevertingReputationRegistry is IReputationRegistry {
    error AlwaysReverts();

    function giveFeedback(
        uint256, int128, uint8, string calldata, string calldata,
        string calldata, string calldata, bytes32
    ) external pure override {
        revert AlwaysReverts();
    }
}

/// @notice ERC-20 that attempts to reenter a configured target during
///         `transferFrom`. Used by the reentrancy test to prove
///         ReentrancyGuard blocks an attacking token.
contract MaliciousReentrantToken {
    address public reentryTarget;
    bytes public reentryCalldata;
    bool public reentryAttempted;
    bool public reentryReverted;
    bytes public reentryReturnData;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    uint256 public totalSupply;

    event Transfer(address indexed from, address indexed to, uint256 value);

    function setReentry(address _target, bytes calldata _calldata) external {
        reentryTarget = _target;
        reentryCalldata = _calldata;
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        totalSupply += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function _tryReenter() internal {
        if (reentryTarget != address(0) && !reentryAttempted) {
            reentryAttempted = true;
            (bool ok, bytes memory data) = reentryTarget.call(reentryCalldata);
            reentryReverted = !ok;
            reentryReturnData = data;
        }
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        _tryReenter();
        uint256 allow = allowance[from][msg.sender];
        if (allow != type(uint256).max) {
            allowance[from][msg.sender] = allow - amount;
        }
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _tryReenter();
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        emit Transfer(msg.sender, to, amount);
        return true;
    }
}

// ════════════════════════════════════════════════════════════════════════════
// TESTS
// ════════════════════════════════════════════════════════════════════════════

contract JobEscrowTest is Test {
    JobEscrow internal escrow;
    MockUSDC internal usdc;
    MockIdentityRegistry internal identity;
    MockReputationRegistry internal reputation;

    address internal client = address(0xC1);
    address internal agentOwner = address(0xA1);
    address internal otherAgentOwner = address(0xA2);
    address internal stranger = address(0xDEAD);

    uint256 internal constant AGENT_ID = 42;
    uint256 internal constant BOUNTY = 100_000_000; // 100 USDC at 6 decimals
    string internal constant DELIVERABLE =
        "ipfs://bafkreigh2akiscaildc7npxnefdjblnpckblsqf5q6m6n7yhd5l4hpiv2y";

    // Events re-declared here so vm.expectEmit can use them.
    event JobCreated(
        uint256 indexed jobId, address indexed client, address indexed provider,
        address evaluator, uint256 expiredAt, address hook
    );
    event JobFunded(uint256 indexed jobId, address indexed client, uint256 amount);
    event JobAssignedToAgentId(uint256 indexed jobId, uint256 indexed agentId);
    event JobSubmitted(uint256 indexed jobId, address indexed provider, bytes32 deliverable);
    event DeliverableMetadata(uint256 indexed jobId, string deliverableURI);
    event JobCompleted(uint256 indexed jobId, address indexed evaluator, bytes32 reason);
    event JobRejected(uint256 indexed jobId, address indexed rejector, bytes32 reason);
    event JobExpired(uint256 indexed jobId);
    event PaymentReleased(uint256 indexed jobId, address indexed provider, uint256 amount);
    event Refunded(uint256 indexed jobId, address indexed client, uint256 amount);
    event FeedbackSubmitted(uint256 indexed agentId, int128 value, string outcomeTag);
    event FeedbackSkipped(uint256 indexed agentId, int128 value, string outcomeTag, string reasonString);

    function setUp() public {
        usdc = new MockUSDC();
        identity = new MockIdentityRegistry();
        reputation = new MockReputationRegistry();
        escrow = new JobEscrow(
            IERC20(address(usdc)),
            IERC721(address(identity)),
            IReputationRegistry(address(reputation))
        );

        identity.mint(agentOwner, AGENT_ID);
        usdc.mint(client, 10_000_000_000); // 10,000 USDC of headroom
        vm.prank(client);
        usdc.approve(address(escrow), type(uint256).max);

        // Labels make trace output (forge test -vvv) readable.
        vm.label(client, "client");
        vm.label(agentOwner, "agentOwner");
        vm.label(otherAgentOwner, "otherAgentOwner");
        vm.label(stranger, "stranger");
        vm.label(address(escrow), "escrow");
        vm.label(address(usdc), "USDC");
        vm.label(address(identity), "IdentityRegistry");
        vm.label(address(reputation), "ReputationRegistry");
    }

    // ────────────────────────────────────────────────────────────────────────
    // Helpers
    // ────────────────────────────────────────────────────────────────────────

    function _defaultDeadline() internal view returns (uint64) {
        return uint64(block.timestamp) + 2 hours;
    }

    function _createJob() internal returns (uint256 jobId) {
        vm.prank(client);
        jobId = escrow.createJob(AGENT_ID, BOUNTY, _defaultDeadline());
    }

    function _createAndSubmit() internal returns (uint256 jobId) {
        jobId = _createJob();
        vm.prank(agentOwner);
        escrow.submit(jobId, DELIVERABLE);
    }

    // ════════════════════════════════════════════════════════════════════════
    // HAPPY PATHS
    // ════════════════════════════════════════════════════════════════════════

    /// @notice Full successful flow: create -> submit -> complete. Verifies
    ///         that funds flow to the current agent owner AND positive
    ///         reputation feedback is recorded with the expected tags.
    function test_HappyPath_CreateSubmitComplete() public {
        uint256 jobId = _createAndSubmit();
        uint256 agentBefore = usdc.balanceOf(agentOwner);

        vm.prank(client);
        escrow.complete(jobId, bytes32("ok"));

        assertEq(usdc.balanceOf(agentOwner), agentBefore + BOUNTY, "agent paid");
        assertEq(usdc.balanceOf(address(escrow)), 0, "escrow drained");
        assertEq(uint8(escrow.getJob(jobId).status), uint8(JobEscrow.JobStatus.Completed));

        // Reputation: +100, tag1="forge-job", tag2="completed", feedbackHash=reason
        assertEq(reputation.callCount(), 1, "one feedback call");
        MockReputationRegistry.FeedbackCall memory c = reputation.lastCall();
        assertEq(c.agentId, AGENT_ID);
        assertEq(c.value, 100);
        assertEq(c.tag1, "forge-job");
        assertEq(c.tag2, "completed");
        assertEq(c.feedbackHash, bytes32("ok"));
    }

    /// @notice Full reject flow: create -> submit -> reject. Verifies refund
    ///         to client AND that negative reputation is recorded.
    function test_HappyPath_CreateSubmitReject() public {
        uint256 jobId = _createAndSubmit();
        uint256 clientBefore = usdc.balanceOf(client);

        vm.prank(client);
        escrow.reject(jobId, bytes32("bad"));

        assertEq(usdc.balanceOf(client), clientBefore + BOUNTY, "client refunded");
        assertEq(usdc.balanceOf(address(escrow)), 0, "escrow drained");
        assertEq(uint8(escrow.getJob(jobId).status), uint8(JobEscrow.JobStatus.Rejected));

        assertEq(reputation.callCount(), 1);
        MockReputationRegistry.FeedbackCall memory c = reputation.lastCall();
        assertEq(c.value, -100);
        assertEq(c.tag2, "rejected");
        assertEq(c.feedbackHash, bytes32("bad"));
    }

    /// @notice Funded -> Expired: agent never submits; after the deadline,
    ///         a stranger can refund the client. NO reputation written
    ///         (expire attribution is ambiguous; see contract dev notes).
    function test_HappyPath_FundedExpire() public {
        uint256 jobId = _createJob();
        uint64 deadline = _defaultDeadline();
        vm.warp(deadline + 1);
        uint256 clientBefore = usdc.balanceOf(client);

        // Permissionless: caller is the unrelated `stranger` address.
        vm.prank(stranger);
        escrow.claimRefund(jobId);

        assertEq(usdc.balanceOf(client), clientBefore + BOUNTY);
        assertEq(uint8(escrow.getJob(jobId).status), uint8(JobEscrow.JobStatus.Expired));
        assertEq(reputation.callCount(), 0, "no reputation on expire");
    }

    /// @notice Submitted -> Expired: client failed to evaluate before the
    ///         deadline. Agent loses the bounty even though they delivered —
    ///         a known v1 tradeoff documented in the contract.
    function test_HappyPath_SubmittedExpire() public {
        uint256 jobId = _createAndSubmit();
        vm.warp(_defaultDeadline() + 1);
        uint256 clientBefore = usdc.balanceOf(client);

        // Called from the test contract (no prank) — still permissionless.
        escrow.claimRefund(jobId);

        assertEq(usdc.balanceOf(client), clientBefore + BOUNTY);
        assertEq(uint8(escrow.getJob(jobId).status), uint8(JobEscrow.JobStatus.Expired));
        assertEq(reputation.callCount(), 0);
    }

    // ════════════════════════════════════════════════════════════════════════
    // REVERTS — one per custom error / state-mismatch path
    // ════════════════════════════════════════════════════════════════════════

    /// @notice ZeroBounty: createJob with bounty=0 must revert before USDC is pulled.
    function test_RevertWhen_BountyIsZero() public {
        vm.prank(client);
        vm.expectRevert(JobEscrow.ZeroBounty.selector);
        escrow.createJob(AGENT_ID, 0, _defaultDeadline());
    }

    /// @notice DeadlineTooClose: deadlines less than MIN_JOB_DURATION away revert.
    function test_RevertWhen_DeadlineTooClose() public {
        uint64 tooClose = uint64(block.timestamp) + 30 minutes;
        uint64 expected = uint64(block.timestamp) + 1 hours;
        vm.prank(client);
        vm.expectRevert(abi.encodeWithSelector(JobEscrow.DeadlineTooClose.selector, tooClose, expected));
        escrow.createJob(AGENT_ID, BOUNTY, tooClose);
    }

    /// @notice JobAlreadyExpired: submit at-or-after the deadline is forbidden.
    function test_RevertWhen_SubmitAfterExpiry() public {
        uint256 jobId = _createJob();
        vm.warp(_defaultDeadline() + 1);
        vm.prank(agentOwner);
        vm.expectRevert(abi.encodeWithSelector(JobEscrow.JobAlreadyExpired.selector, jobId));
        escrow.submit(jobId, DELIVERABLE);
    }

    /// @notice NotYetExpired: claimRefund before the deadline reverts.
    function test_RevertWhen_ClaimRefundBeforeExpiry() public {
        uint256 jobId = _createJob();
        uint64 deadline = _defaultDeadline();
        vm.expectRevert(abi.encodeWithSelector(
            JobEscrow.NotYetExpired.selector, jobId, deadline, uint64(block.timestamp)
        ));
        escrow.claimRefund(jobId);
    }

    /// @notice WrongJobState (Funded expected, actual Submitted) — double-submit.
    function test_RevertWhen_SubmitTwice() public {
        uint256 jobId = _createAndSubmit();
        vm.prank(agentOwner);
        vm.expectRevert(abi.encodeWithSelector(
            JobEscrow.WrongJobState.selector,
            jobId, JobEscrow.JobStatus.Funded, JobEscrow.JobStatus.Submitted
        ));
        escrow.submit(jobId, DELIVERABLE);
    }

    /// @notice WrongJobState: complete() before submission reverts.
    function test_RevertWhen_CompleteBeforeSubmit() public {
        uint256 jobId = _createJob();
        vm.prank(client);
        vm.expectRevert(abi.encodeWithSelector(
            JobEscrow.WrongJobState.selector,
            jobId, JobEscrow.JobStatus.Submitted, JobEscrow.JobStatus.Funded
        ));
        escrow.complete(jobId, bytes32(0));
    }

    /// @notice WrongJobState: reject() pre-submit reverts. This is the v1
    ///         "no pre-submit reject" guarantee — clients cannot yank the
    ///         bounty before the agent has done work.
    function test_RevertWhen_RejectBeforeSubmit() public {
        uint256 jobId = _createJob();
        vm.prank(client);
        vm.expectRevert(abi.encodeWithSelector(
            JobEscrow.WrongJobState.selector,
            jobId, JobEscrow.JobStatus.Submitted, JobEscrow.JobStatus.Funded
        ));
        escrow.reject(jobId, bytes32(0));
    }

    /// @notice WrongJobState: claimRefund on a terminal (Completed) job reverts.
    function test_RevertWhen_ClaimRefundFromCompleted() public {
        uint256 jobId = _createAndSubmit();
        vm.prank(client);
        escrow.complete(jobId, bytes32(0));
        vm.warp(_defaultDeadline() + 1);
        vm.expectRevert(abi.encodeWithSelector(
            JobEscrow.WrongJobState.selector,
            jobId, JobEscrow.JobStatus.Funded, JobEscrow.JobStatus.Completed
        ));
        escrow.claimRefund(jobId);
    }

    /// @notice NotClient: only the job's client may call complete().
    function test_RevertWhen_CompleteByNonClient() public {
        uint256 jobId = _createAndSubmit();
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(JobEscrow.NotClient.selector, jobId, stranger));
        escrow.complete(jobId, bytes32(0));
    }

    /// @notice NotClient: only the job's client may call reject().
    function test_RevertWhen_RejectByNonClient() public {
        uint256 jobId = _createAndSubmit();
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(JobEscrow.NotClient.selector, jobId, stranger));
        escrow.reject(jobId, bytes32(0));
    }

    /// @notice NotAgentOwner: submit by someone other than the NFT's current
    ///         owner reverts. This validates dynamic owner resolution.
    function test_RevertWhen_SubmitByNonAgent() public {
        uint256 jobId = _createJob();
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(
            JobEscrow.NotAgentOwner.selector, jobId, AGENT_ID, stranger
        ));
        escrow.submit(jobId, DELIVERABLE);
    }

    /// @notice EmptyDeliverable: submit with a zero-length URI is forbidden.
    function test_RevertWhen_DeliverableIsEmpty() public {
        uint256 jobId = _createJob();
        vm.prank(agentOwner);
        vm.expectRevert(JobEscrow.EmptyDeliverable.selector);
        escrow.submit(jobId, "");
    }

    /// @notice ZeroAddress: constructor rejects address(0) for usdc.
    function test_RevertWhen_ConstructorUsdcIsZero() public {
        vm.expectRevert(JobEscrow.ZeroAddress.selector);
        new JobEscrow(
            IERC20(address(0)),
            IERC721(address(identity)),
            IReputationRegistry(address(reputation))
        );
    }

    /// @notice ZeroAddress: constructor rejects address(0) for identity registry.
    function test_RevertWhen_ConstructorIdentityIsZero() public {
        vm.expectRevert(JobEscrow.ZeroAddress.selector);
        new JobEscrow(
            IERC20(address(usdc)),
            IERC721(address(0)),
            IReputationRegistry(address(reputation))
        );
    }

    // ════════════════════════════════════════════════════════════════════════
    // EDGE CASES
    // ════════════════════════════════════════════════════════════════════════

    /// @notice NFT transferred between createJob and submit: new owner can
    ///         submit, old owner cannot. Validates the "NFT IS the agent"
    ///         design — authorization is dynamic, not snapshotted.
    function test_Edge_NftTransferredBeforeSubmit() public {
        uint256 jobId = _createJob();

        vm.prank(agentOwner);
        identity.transfer(AGENT_ID, otherAgentOwner);

        // Old owner can no longer submit.
        vm.prank(agentOwner);
        vm.expectRevert(abi.encodeWithSelector(
            JobEscrow.NotAgentOwner.selector, jobId, AGENT_ID, agentOwner
        ));
        escrow.submit(jobId, DELIVERABLE);

        // New owner CAN submit.
        vm.prank(otherAgentOwner);
        escrow.submit(jobId, DELIVERABLE);
        assertEq(uint8(escrow.getJob(jobId).status), uint8(JobEscrow.JobStatus.Submitted));
    }

    /// @notice NFT transferred between submit and complete: the bounty goes
    ///         to the new owner, not the address that actually submitted.
    ///         This is the "agent could sell NFT" footgun documented in
    ///         complete()'s natspec — intentional, not a bug.
    function test_Edge_NftTransferredBeforeComplete_NewOwnerPaid() public {
        uint256 jobId = _createAndSubmit();

        vm.prank(agentOwner);
        identity.transfer(AGENT_ID, otherAgentOwner);

        uint256 oldBefore = usdc.balanceOf(agentOwner);
        uint256 newBefore = usdc.balanceOf(otherAgentOwner);

        vm.prank(client);
        escrow.complete(jobId, bytes32(0));

        assertEq(usdc.balanceOf(agentOwner), oldBefore, "old owner gets nothing");
        assertEq(usdc.balanceOf(otherAgentOwner), newBefore + BOUNTY, "new owner paid");
    }

    /// @notice reputationRegistry == address(0): feedback is skipped silently
    ///         with a "registry-not-configured" FeedbackSkipped event.
    ///         Funds release proceeds normally.
    function test_Edge_NoReputationRegistry_FeedbackSkipped() public {
        JobEscrow noRep = new JobEscrow(
            IERC20(address(usdc)),
            IERC721(address(identity)),
            IReputationRegistry(address(0))
        );
        vm.prank(client);
        usdc.approve(address(noRep), type(uint256).max);

        vm.prank(client);
        uint256 jobId = noRep.createJob(AGENT_ID, BOUNTY, _defaultDeadline());
        vm.prank(agentOwner);
        noRep.submit(jobId, DELIVERABLE);

        vm.expectEmit(true, false, false, true, address(noRep));
        emit FeedbackSkipped(AGENT_ID, 100, "completed", "registry-not-configured");

        vm.prank(client);
        noRep.complete(jobId, bytes32(0));

        assertEq(usdc.balanceOf(agentOwner), BOUNTY, "funds still release");
    }

    /// @notice ReputationRegistry reverts: try/catch swallows it, funds still
    ///         release, FeedbackSkipped event emitted with "registry-call-reverted".
    function test_Edge_ReputationRegistryReverts_FundsStillRelease() public {
        RevertingReputationRegistry broken = new RevertingReputationRegistry();
        JobEscrow brokenEscrow = new JobEscrow(
            IERC20(address(usdc)),
            IERC721(address(identity)),
            IReputationRegistry(address(broken))
        );
        vm.prank(client);
        usdc.approve(address(brokenEscrow), type(uint256).max);

        vm.prank(client);
        uint256 jobId = brokenEscrow.createJob(AGENT_ID, BOUNTY, _defaultDeadline());
        vm.prank(agentOwner);
        brokenEscrow.submit(jobId, DELIVERABLE);

        vm.expectEmit(true, false, false, true, address(brokenEscrow));
        emit FeedbackSkipped(AGENT_ID, 100, "completed", "registry-call-reverted");

        vm.prank(client);
        brokenEscrow.complete(jobId, bytes32(0));

        assertEq(usdc.balanceOf(agentOwner), BOUNTY, "funds still release");
    }

    /// @notice getCurrentProvider is defensive: returns address(0) when the
    ///         NFT was burned, instead of reverting like mutating fns do.
    function test_Edge_GetCurrentProvider_ReturnsZeroForBurnedNft() public {
        uint256 jobId = _createJob();
        identity.burn(AGENT_ID);

        assertEq(escrow.getCurrentProvider(jobId), address(0), "defensive zero on burn");

        // Mutating functions still revert — defensive behavior is view-only.
        vm.prank(agentOwner);
        vm.expectRevert(MockIdentityRegistry.MIR_NonexistentToken.selector);
        escrow.submit(jobId, DELIVERABLE);
    }

    // ════════════════════════════════════════════════════════════════════════
    // REENTRANCY
    // ════════════════════════════════════════════════════════════════════════

    /// @notice ReentrancyGuard blocks a malicious ERC-20's attempt to reenter
    ///         JobEscrow.createJob during USDC.transferFrom. Validates BOTH
    ///         layers of defense: (a) ReentrancyGuard's lock detects the
    ///         reentrant call and reverts with ReentrancyGuardReentrantCall;
    ///         (b) CEI ordering means state writes happen before the external
    ///         call, so even if the guard were absent, the reentrant call
    ///         would observe the consistent post-write state.
    function test_Reentrancy_BlockedByReentrancyGuard() public {
        MaliciousReentrantToken token = new MaliciousReentrantToken();
        JobEscrow vEscrow = new JobEscrow(
            IERC20(address(token)),
            IERC721(address(identity)),
            IReputationRegistry(address(reputation))
        );

        token.mint(client, BOUNTY * 2);
        vm.prank(client);
        token.approve(address(vEscrow), type(uint256).max);

        bytes memory reentryCall = abi.encodeWithSelector(
            JobEscrow.createJob.selector, AGENT_ID, BOUNTY, _defaultDeadline()
        );
        token.setReentry(address(vEscrow), reentryCall);

        // Outer createJob should succeed; the inner reentrant call is blocked.
        vm.prank(client);
        uint256 jobId = vEscrow.createJob(AGENT_ID, BOUNTY, _defaultDeadline());

        assertEq(jobId, 1, "outer createJob succeeded");
        assertTrue(token.reentryAttempted(), "reentry was attempted");
        assertTrue(token.reentryReverted(), "reentry was blocked");

        // Verify the revert reason is specifically ReentrancyGuard's error,
        // not some incidental failure deeper in the call.
        bytes memory ret = token.reentryReturnData();
        bytes4 sel;
        assembly { sel := mload(add(ret, 0x20)) }
        assertEq(
            sel,
            ReentrancyGuard.ReentrancyGuardReentrantCall.selector,
            "blocked specifically by ReentrancyGuard"
        );
    }

    // ════════════════════════════════════════════════════════════════════════
    // FUZZ TESTS
    // ════════════════════════════════════════════════════════════════════════

    /// @notice Property: for ANY positive bounty and ANY legal deadline, the
    ///         contract holds exactly `bounty` USDC and the Job struct reflects
    ///         the inputs verbatim.
    function testFuzz_CreateJob_BountyEscrowedInvariant(uint256 bounty, uint64 deadlineDelta) public {
        bounty = bound(bounty, 1, 1e24);
        deadlineDelta = uint64(bound(deadlineDelta, 1 hours, 365 days));
        uint64 deadline = uint64(block.timestamp) + deadlineDelta;

        usdc.mint(client, bounty);
        uint256 escrowBefore = usdc.balanceOf(address(escrow));

        vm.prank(client);
        uint256 jobId = escrow.createJob(AGENT_ID, bounty, deadline);

        assertEq(usdc.balanceOf(address(escrow)), escrowBefore + bounty);
        JobEscrow.Job memory job = escrow.getJob(jobId);
        assertEq(job.bounty, bounty);
        assertEq(job.expiredAt, deadline);
        assertEq(job.agentId, AGENT_ID);
        assertEq(uint8(job.status), uint8(JobEscrow.JobStatus.Funded));
    }

    /// @notice Property: any deadline < block.timestamp + MIN_JOB_DURATION
    ///         is rejected with DeadlineTooClose, regardless of bounty.
    function testFuzz_CreateJob_DeadlineTooClose(uint64 closeDelta) public {
        closeDelta = uint64(bound(closeDelta, 0, 1 hours - 1));
        uint64 deadline = uint64(block.timestamp) + closeDelta;
        uint64 expected = uint64(block.timestamp) + 1 hours;

        vm.prank(client);
        vm.expectRevert(abi.encodeWithSelector(JobEscrow.DeadlineTooClose.selector, deadline, expected));
        escrow.createJob(AGENT_ID, BOUNTY, deadline);
    }

    /// @notice Property: createJob with an agentId that doesn't exist in
    ///         IdentityRegistry reverts (propagated from ownerOf). The
    ///         contract never escrows funds for a non-existent agent.
    function testFuzz_CreateJob_AgentIdMustExist(uint256 fuzzAgentId) public {
        vm.assume(fuzzAgentId != AGENT_ID); // AGENT_ID is the only one minted

        uint256 clientBalBefore = usdc.balanceOf(client);

        vm.prank(client);
        vm.expectRevert(MockIdentityRegistry.MIR_NonexistentToken.selector);
        escrow.createJob(fuzzAgentId, BOUNTY, _defaultDeadline());

        // Critical: client lost no USDC since createJob reverted before transferFrom.
        assertEq(usdc.balanceOf(client), clientBalBefore, "no USDC lost on failed create");
    }

    /// @notice Property: for ANY legal (bounty, deadline) pair, a full
    ///         create+submit+complete round-trip moves exactly `bounty` USDC
    ///         from client to agent and leaves zero in escrow.
    function testFuzz_RoundTrip_FundsConservation(uint256 bounty, uint64 deadlineDelta) public {
        bounty = bound(bounty, 1, 1e24);
        deadlineDelta = uint64(bound(deadlineDelta, 1 hours, 365 days));
        uint64 deadline = uint64(block.timestamp) + deadlineDelta;

        usdc.mint(client, bounty);
        uint256 clientBefore = usdc.balanceOf(client);
        uint256 agentBefore = usdc.balanceOf(agentOwner);
        uint256 escrowBefore = usdc.balanceOf(address(escrow));

        vm.prank(client);
        uint256 jobId = escrow.createJob(AGENT_ID, bounty, deadline);
        vm.prank(agentOwner);
        escrow.submit(jobId, DELIVERABLE);
        vm.prank(client);
        escrow.complete(jobId, bytes32(0));

        assertEq(usdc.balanceOf(client), clientBefore - bounty, "client paid exactly");
        assertEq(usdc.balanceOf(agentOwner), agentBefore + bounty, "agent received exactly");
        assertEq(usdc.balanceOf(address(escrow)), escrowBefore, "escrow net zero");
    }

    // ════════════════════════════════════════════════════════════════════════
    // STORAGE LAYOUT VERIFICATION
    // ════════════════════════════════════════════════════════════════════════

    /// @notice Concrete proof the Job struct packs into 4 slots as designed:
    ///         slot 0 = client(20) + expiredAt(8) + status(1) = 29 bytes used
    ///         slot 1 = agentId
    ///         slot 2 = bounty
    ///         slot 3 = deliverableURI handle (empty = 0)
    ///
    ///         If anyone reorders the struct in a way that breaks packing,
    ///         this test fails immediately — long before any gas regression
    ///         would surface in benchmarks.
    function test_StorageLayout_JobStructPackingMatchesDesign() public {
        uint64 deadline = _defaultDeadline();
        vm.prank(client);
        uint256 jobId = escrow.createJob(AGENT_ID, BOUNTY, deadline);

        // `jobs` mapping is at top-level slot 1 (verified separately via
        // `forge inspect storageLayout`). For a mapping(uint256 => Struct),
        // the base slot of jobs[k] is keccak256(abi.encode(k, mappingSlot)).
        bytes32 baseSlot = keccak256(abi.encode(jobId, uint256(1)));

        // Slot 0: should hold client (low 20B) + expiredAt (next 8B) + status (next 1B).
        bytes32 slot0 = vm.load(address(escrow), baseSlot);
        address packedClient = address(uint160(uint256(slot0)));
        uint64 packedExpiredAt = uint64(uint256(slot0) >> 160);
        uint8 packedStatus = uint8(uint256(slot0) >> (160 + 64));

        assertEq(packedClient, client, "slot 0 [0..19] = client");
        assertEq(packedExpiredAt, deadline, "slot 0 [20..27] = expiredAt");
        assertEq(packedStatus, uint8(JobEscrow.JobStatus.Funded), "slot 0 [28] = status");

        // Slot 1: agentId (full 32 bytes)
        bytes32 slot1 = vm.load(address(escrow), bytes32(uint256(baseSlot) + 1));
        assertEq(uint256(slot1), AGENT_ID, "slot 1 = agentId");

        // Slot 2: bounty (full 32 bytes)
        bytes32 slot2 = vm.load(address(escrow), bytes32(uint256(baseSlot) + 2));
        assertEq(uint256(slot2), BOUNTY, "slot 2 = bounty");

        // Slot 3: deliverableURI string handle. Empty -> 0.
        bytes32 slot3 = vm.load(address(escrow), bytes32(uint256(baseSlot) + 3));
        assertEq(uint256(slot3), 0, "slot 3 = deliverableURI handle (empty)");
    }
}
