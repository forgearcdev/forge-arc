// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test, Vm} from "forge-std/Test.sol";
import {JobEscrow, IReputationRegistry} from "../src/JobEscrow.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";

/// @notice Subset of ERC-8004 IdentityRegistry we need beyond the IERC721 surface.
interface IIdentityRegistry {
    function register(string calldata metadataURI) external returns (uint256);
}

/// @notice Shim contract `vm.etch`'d at Arc's native-asset transfer precompile
///         (0x1800...0000) so USDC transfers actually move balances in fork
///         tests. On the live Arc chain, this precompile is consensus-level
///         code that atomically updates native USDC balances. In a Foundry
///         fork, the precompile doesn't exist — without this shim, every
///         USDC transferFrom/transfer reverts with StackUnderflow.
///
/// @dev    The shim uses the Foundry cheatcode `vm.deal` (callable from
///         etched code at any address) to mirror the precompile's effect.
///         18-decimal native units in == 18-decimal native units out; USDC's
///         6-decimal view is computed by USDC's own contract via /1e12.
contract NativeUsdcTransferShim {
    Vm constant vmCheats = Vm(0x7109709ECfa91a80626fF3989D68f67F5b1DD12D);

    function transfer(address from, address to, uint256 amount) external returns (bool) {
        vmCheats.deal(from, from.balance - amount);
        vmCheats.deal(to, to.balance + amount);
        return true;
    }
}

/// @notice Subset of ERC-8004 ReputationRegistry needed to read back the
///         feedback our escrow writes.
interface IReputationRegistryRead {
    function getLastIndex(uint256 agentId, address clientAddress) external view returns (uint64);

    function readFeedback(uint256 agentId, address clientAddress, uint64 feedbackIndex)
        external
        view
        returns (int128 value, uint8 valueDecimals, string memory tag1, string memory tag2, bool isRevoked);
}

/**
 * @notice Integration tests against the REAL Arc testnet contracts (USDC,
 *         IdentityRegistry, ReputationRegistry). No mocks.
 *
 * @dev    Skip behavior: if the `ARC_RPC_URL` env var is unset or empty, the
 *         entire contract is skipped via vm.skip in setUp. This lets the
 *         normal `forge test` run fast without ever hitting the network.
 *         To execute these tests:
 *
 *             forge test --match-contract JobEscrowForkTest \
 *                        --fork-url $ARC_RPC_URL -vv
 *
 * @dev    No fuzz tests in this file — every iteration would hit the public
 *         Arc RPC and risk rate-limit issues. Determinism over coverage at
 *         this layer; the mock-based suite already fuzzes invariants.
 */
contract JobEscrowForkTest is Test {
    // ────────────────────────────────────────────────────────────────────
    // Canonical Arc testnet addresses (verified in STEP 2 via `cast code`)
    // ────────────────────────────────────────────────────────────────────
    uint256 internal constant ARC_TESTNET_CHAIN_ID = 5042002;
    address internal constant USDC = 0x3600000000000000000000000000000000000000;
    address internal constant IDENTITY_REGISTRY = 0x8004A818BFB912233c491871b3d84c89A494BD9e;
    address internal constant REPUTATION_REGISTRY = 0x8004B663056A597Dffe9eCcC1965A193B7388713;

    // ────────────────────────────────────────────────────────────────────
    // Test state
    // ────────────────────────────────────────────────────────────────────
    JobEscrow internal escrow;
    address internal client;
    address internal agentOwner;
    uint256 internal agentId;

    uint256 internal constant BOUNTY = 10_000_000; // 10 USDC (6 decimals)
    string internal constant DELIVERABLE = "ipfs://bafkreigh2akiscaildc7npxnefdjblnpckblsqf5q6m6n7yhd5l4hpiv2y";

    // Event topic we'll search for in the recorded logs test
    bytes32 internal constant JOB_CREATED_TOPIC =
        keccak256("JobCreated(uint256,address,address,address,uint256,address)");

    function setUp() public {
        // Skip entirely if no fork URL is configured.
        string memory rpcUrl = vm.envOr("ARC_RPC_URL", string(""));
        if (bytes(rpcUrl).length == 0) {
            vm.skip(true);
            return;
        }

        // Fork the live chain. createSelectFork sets this as the active fork
        // for the rest of the test contract's execution.
        vm.createSelectFork(rpcUrl);
        require(block.chainid == ARC_TESTNET_CHAIN_ID, "fork landed on wrong chain");

        // Patch Arc's consensus-level precompiles that USDC depends on, since
        // neither exists in Foundry's local fork.
        //
        //   1. Blocklist precompile at 0x1800...0001: mocked to always return
        //      false ("not blocklisted"). Production behavior is preserved;
        //      only the local simulation is patched.
        //   2. Native transfer precompile at 0x1800...0000: replaced via
        //      vm.etch with NativeUsdcTransferShim, which uses vm.deal to
        //      actually move balances. Without this, every USDC transfer
        //      reverts with StackUnderflow and our tests can't observe
        //      balance changes through the real USDC contract.
        vm.mockCall(
            address(0x1800000000000000000000000000000000000001),
            abi.encodeWithSignature("isBlocklisted(address)"),
            abi.encode(false)
        );
        NativeUsdcTransferShim shim = new NativeUsdcTransferShim();
        vm.etch(address(0x1800000000000000000000000000000000000000), address(shim).code);
        // Foundry blocks cheatcode calls from arbitrary addresses by default;
        // the etched shim needs explicit permission so its vm.deal calls work.
        vm.allowCheatcodes(address(0x1800000000000000000000000000000000000000));

        // Deterministic test wallet addresses (labelled for nice traces).
        client = makeAddr("forkClient");
        agentOwner = makeAddr("forkAgentOwner");
        vm.label(client, "forkClient");
        vm.label(agentOwner, "forkAgentOwner");
        vm.label(USDC, "USDC(arc)");
        vm.label(IDENTITY_REGISTRY, "IdentityRegistry(arc)");
        vm.label(REPUTATION_REGISTRY, "ReputationRegistry(arc)");

        // Fund accounts with USDC via vm.deal. NB: Arc's USDC ERC-20 view at
        // 0x3600... reports balanceOf as `native_wei / 1e12` — it converts
        // from Arc's 18-decimal internal gas representation to standard
        // 6-decimal USDC on the fly. So to credit a recipient with N USDC
        // (6-decimal units), we set their native balance to N * 1e12.
        // address(this) starts with Foundry's default of ~7.9e16 USDC
        // (= uint96.max / 1e12), more than enough to deploy and run tests;
        // we only need to fund the makeAddr() wallets, which start at zero.
        _fundWithUSDC(client, 1_000_000_000); // 1000 USDC
        _fundWithUSDC(agentOwner, 1_000_000_000); // 1000 USDC

        // Deploy our JobEscrow wired to the REAL Arc contracts.
        escrow = new JobEscrow(
            IERC20(USDC),
            IERC721(IDENTITY_REGISTRY),
            IReputationRegistry(REPUTATION_REGISTRY)
        );
        vm.label(address(escrow), "JobEscrow(fork)");

        // Register a fresh agent on the canonical IdentityRegistry. Returns
        // the newly minted tokenId, which we capture for tests to use.
        vm.prank(agentOwner);
        agentId = IIdentityRegistry(IDENTITY_REGISTRY).register("ipfs://forge-test-agent-metadata");

        // Sanity: registry now reports agentOwner as the NFT owner.
        require(
            IERC721(IDENTITY_REGISTRY).ownerOf(agentId) == agentOwner,
            "ownerOf mismatch immediately after register"
        );

        // Client approves USDC to the escrow (max allowance for test convenience).
        vm.prank(client);
        IERC20(USDC).approve(address(escrow), type(uint256).max);
    }

    // ────────────────────────────────────────────────────────────────────
    // USDC funding helper
    // ────────────────────────────────────────────────────────────────────

    /// @notice Fund `recipient` with `amount6` USDC (6-decimal units) on Arc.
    ///
    /// @dev    Arc-specific math: the USDC ERC-20 contract reports
    ///         `balanceOf(x) = x.balance / 1e12`. So crediting N USDC requires
    ///         setting native balance to N * 1e12. Discovered empirically by
    ///         observing that Foundry's default test-contract native balance
    ///         (uint96.max = 7.9e28 wei) shows up as 7.9e16 via balanceOf —
    ///         exactly /1e12.
    function _fundWithUSDC(address recipient, uint256 amount6) internal {
        uint256 nativeIncrement = amount6 * 1e12;
        vm.deal(recipient, recipient.balance + nativeIncrement);
        require(
            IERC20(USDC).balanceOf(recipient) >= amount6,
            "USDC funding insufficient even after vm.deal - unit conversion may be wrong"
        );
    }

    // ════════════════════════════════════════════════════════════════════
    // INTEGRATION TESTS
    // ════════════════════════════════════════════════════════════════════

    /// @notice End-to-end against real Arc contracts: register an agent,
    ///         create a job funded in real USDC, submit a deliverable,
    ///         complete the job, and verify USDC actually moved through the
    ///         live precompile-class USDC contract.
    function test_Fork_HappyPath_CreateSubmitComplete() public {
        uint256 clientBefore = IERC20(USDC).balanceOf(client);
        uint256 agentBefore = IERC20(USDC).balanceOf(agentOwner);
        uint256 escrowBefore = IERC20(USDC).balanceOf(address(escrow));

        uint64 deadline = uint64(block.timestamp) + 2 hours;

        // ---- createJob ----
        vm.prank(client);
        uint256 jobId = escrow.createJob(agentId, BOUNTY, deadline);

        assertEq(IERC20(USDC).balanceOf(client), clientBefore - BOUNTY, "client debited");
        assertEq(IERC20(USDC).balanceOf(address(escrow)), escrowBefore + BOUNTY, "escrow funded");
        assertEq(uint8(escrow.getJob(jobId).status), uint8(JobEscrow.JobStatus.Funded));

        // ---- submit ----
        vm.prank(agentOwner);
        escrow.submit(jobId, DELIVERABLE);
        assertEq(uint8(escrow.getJob(jobId).status), uint8(JobEscrow.JobStatus.Submitted));

        // ---- complete ----
        vm.prank(client);
        escrow.complete(jobId, bytes32("integration-ok"));

        assertEq(IERC20(USDC).balanceOf(agentOwner), agentBefore + BOUNTY, "agent paid via real USDC");
        assertEq(IERC20(USDC).balanceOf(address(escrow)), escrowBefore, "escrow back to baseline");
        assertEq(uint8(escrow.getJob(jobId).status), uint8(JobEscrow.JobStatus.Completed));
    }

    /// @notice Verify the REAL ReputationRegistry actually recorded feedback
    ///         after complete(). Reads the registry's state directly to
    ///         confirm — proves the try/catch wrapper successfully went
    ///         through the happy path, and that our tag/value scheme is
    ///         valid input for the canonical contract.
    function test_Fork_ReputationFeedbackActuallyWritten() public {
        // Snapshot the registry state for our (agentId, escrow) pair before
        // we do anything that would write feedback.
        uint64 lastIndexBefore = IReputationRegistryRead(REPUTATION_REGISTRY)
            .getLastIndex(agentId, address(escrow));

        uint64 deadline = uint64(block.timestamp) + 2 hours;

        vm.prank(client);
        uint256 jobId = escrow.createJob(agentId, BOUNTY, deadline);
        vm.prank(agentOwner);
        escrow.submit(jobId, DELIVERABLE);
        vm.prank(client);
        escrow.complete(jobId, bytes32("integration-fb"));

        // Index should have advanced by exactly 1 (we wrote one feedback).
        uint64 lastIndexAfter = IReputationRegistryRead(REPUTATION_REGISTRY)
            .getLastIndex(agentId, address(escrow));
        assertEq(lastIndexAfter, lastIndexBefore + 1, "exactly one feedback recorded");

        // Read the feedback we just wrote. The real ReputationRegistry uses
        // 1-BASED indexing (index 0 is a sentinel for "no entries"; reading
        // at index 0 reverts with "index must be > 0"). So we read at
        // `lastIndexAfter` directly, not `lastIndexAfter - 1`. This was
        // discovered empirically against the deployed contract.
        (int128 value, uint8 decimals, string memory tag1, string memory tag2, bool isRevoked) =
            IReputationRegistryRead(REPUTATION_REGISTRY)
                .readFeedback(agentId, address(escrow), lastIndexAfter);

        assertEq(value, 100, "value = +100 for completed");
        assertEq(decimals, 0, "integer score (no decimals)");
        assertEq(tag1, "forge-job", "tag1 identifies our protocol");
        assertEq(tag2, "completed", "tag2 identifies outcome");
        assertFalse(isRevoked, "fresh feedback is not revoked");
    }

    /// @notice Verify event topic0 of JobCreated matches our locally-computed
    ///         expectation when emitted on the live chain. Confirms ERC-8183-
    ///         shaped indexers will decode our events correctly in production.
    function test_Fork_EventTopicsMatchExpected() public {
        vm.recordLogs();

        uint64 deadline = uint64(block.timestamp) + 2 hours;
        vm.prank(client);
        escrow.createJob(agentId, BOUNTY, deadline);

        Vm.Log[] memory logs = vm.getRecordedLogs();

        // Walk the recorded logs for the JobCreated event from our escrow.
        // (Logs from USDC.Transfer and Identity's events may also appear.)
        bool found;
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].emitter == address(escrow) && logs[i].topics[0] == JOB_CREATED_TOPIC) {
                found = true;
                // Sanity-check the indexed args (jobId, client, provider).
                // jobId is the first indexed param.
                uint256 emittedJobId = uint256(logs[i].topics[1]);
                address emittedClient = address(uint160(uint256(logs[i].topics[2])));
                address emittedProvider = address(uint160(uint256(logs[i].topics[3])));
                assertGt(emittedJobId, 0, "jobId > 0");
                assertEq(emittedClient, client, "client matches");
                assertEq(emittedProvider, agentOwner, "provider snapshot = agentOwner");
                break;
            }
        }
        assertTrue(found, "JobCreated event with expected topic0 was emitted");
    }
}
