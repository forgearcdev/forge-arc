// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console2} from "forge-std/Script.sol";
import {Vm} from "forge-std/Vm.sol";
import {JobEscrow} from "../src/JobEscrow.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";

/// @notice Minimal slice of ERC-8004 ReputationRegistry we need to read back
///         the feedback our escrow writes on complete().
interface IReputationRegistryRead {
    function getLastIndex(uint256 agentId, address clientAddress) external view returns (uint64);

    function readFeedback(uint256 agentId, address clientAddress, uint64 feedbackIndex)
        external
        view
        returns (int128 value, uint8 valueDecimals, string memory tag1, string memory tag2, bool isRevoked);
}

/// @notice Same simulation-only shim as SmokeTest.s.sol - see that file for
///         the full explanation of Arc's native USDC transfer precompile.
contract NativeUsdcTransferShim {
    Vm constant vmCheats = Vm(0x7109709ECfa91a80626fF3989D68f67F5b1DD12D);

    function transfer(address from, address to, uint256 amount) external returns (bool) {
        vmCheats.deal(from, from.balance - amount);
        vmCheats.deal(to, to.balance + amount);
        return true;
    }
}

/**
 * @title  SmokeTestV2
 * @notice Retry of the live-network smoke test, hardened against the
 *         agentId race condition that broke v1.
 *
 *         ⚠️  SINGLE-WALLET CAVEAT  ⚠️
 *         Same as v1: deployer plays BOTH client and agent. The bounty
 *         round-trips, net cost is just gas. This is not a production-shaped
 *         flow; a two-wallet demo remains a separate exercise.
 *
 * @dev    What's different from v1:
 *
 *           1. NO register() call. We reuse the agentId 14776 that the v1
 *              broadcast (accidentally but correctly) minted to the deployer.
 *              Eliminates the dependency on IdentityRegistry's globally-shared
 *              counter - the root cause of the v1 failure.
 *
 *           2. Pre-flight assertions that abort BEFORE broadcasting if chain
 *              state has drifted from what we expect. The two checks together
 *              prove the entire downstream tx sequence will work:
 *                a) IdentityRegistry.ownerOf(14776) == deployer  (we still
 *                   own the agent NFT; nothing transferred or burned)
 *                b) JobEscrow.nextJobId() == EXPECTED_NEXT_JOB_ID  (the
 *                   next createJob will produce jobId = EXPECTED+1; no other
 *                   party has used our JobEscrow in the meantime)
 *
 *           3. Post-broadcast invariant assertions. If the actual jobId or
 *              status doesn't match what we expected, the script reverts
 *              loudly rather than silently logging the wrong number.
 *
 * @dev    Why the remaining script-broadcast pattern is safe here:
 *           - OWNED_AGENT_ID is a constant - never a return value.
 *           - jobId returned by createJob comes from OUR JobEscrow's own
 *             counter, which only advances when someone with this exact
 *             contract address calls createJob. Pre-flight asserts that
 *             counter is at the expected value; no concurrent client of
 *             our contract is reasonably possible mid-broadcast.
 *           - No other tx in this sequence depends on a runtime return
 *             value.
 *
 * @dev    Usage:
 *
 *           Dry-run:
 *             forge script script/SmokeTestV2.s.sol:SmokeTestV2 \
 *               --rpc-url $ARC_RPC_URL --skip-simulation
 *
 *           Broadcast (only after RecoverJob1 has fully landed):
 *             forge script script/SmokeTestV2.s.sol:SmokeTestV2 \
 *               --rpc-url $ARC_RPC_URL --broadcast --skip-simulation
 */
contract SmokeTestV2 is Script {
    // ──────────────────────────────────────────────────────────────────────
    // Constants
    // ──────────────────────────────────────────────────────────────────────
    uint256 internal constant ARC_TESTNET_CHAIN_ID = 5042002;

    address internal constant USDC = 0x3600000000000000000000000000000000000000;
    address internal constant IDENTITY_REGISTRY = 0x8004A818BFB912233c491871b3d84c89A494BD9e;
    address internal constant REPUTATION_REGISTRY = 0x8004B663056A597Dffe9eCcC1965A193B7388713;
    address internal constant JOB_ESCROW = 0x9B02A8BaA84d0B319E5683d9e30838c7D91C414e;

    /// @notice agentId minted to the deployer by SmokeTest v1's register()
    ///         call (tx 0xb7b61abe…20b7c3, block 42,729,978). Verified live:
    ///         ownerOf(14776) == 0xEdF1359ae26501383aD832e207de6579Ba5a0816.
    uint256 internal constant OWNED_AGENT_ID = 14776;

    /// @notice Required value of JobEscrow.nextJobId() at the start of this
    ///         script. After RecoverJob1 has processed job 1, the counter
    ///         stays at 1 (claimRefund doesn't advance it; only createJob
    ///         does). The new createJob will therefore produce jobId = 2.
    uint256 internal constant EXPECTED_NEXT_JOB_ID = 1;

    /// @notice 1 USDC in 6-decimal units.
    uint256 internal constant BOUNTY = 1_000_000;

    /// @notice Different URI from v1 so observers can distinguish the runs
    ///         on the deliverable string alone.
    string internal constant DELIVERABLE_URI = "ipfs://QmTestSmokeTestPlaceholderV2";

    function run() external {
        require(block.chainid == ARC_TESTNET_CHAIN_ID, "SmokeTestV2: not on Arc testnet");

        uint256 deployerPk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPk);

        JobEscrow escrow = JobEscrow(JOB_ESCROW);
        IERC20 usdc = IERC20(USDC);

        // ══════════════════════════════════════════════════════════════════
        // PRE-FLIGHT - assert chain state matches our expectations.
        //
        // These are require()s, not just logs. If reality has drifted, the
        // script aborts BEFORE broadcasting any tx that could cost gas or
        // lock funds. This is the lesson from v1: never let a forge-script
        // broadcast queue ride on values that could change between sim and
        // send.
        // ══════════════════════════════════════════════════════════════════

        // Check 1: We still own the agent NFT. Could fail if we accidentally
        // transferred it, or someone tricked us into burning, or a future
        // version of the IdentityRegistry adopts an unfamiliar semantics.
        address agentOwner = IERC721(IDENTITY_REGISTRY).ownerOf(OWNED_AGENT_ID);
        require(
            agentOwner == deployer,
            "SmokeTestV2: deployer no longer owns OWNED_AGENT_ID - aborting"
        );

        // Check 2: JobEscrow's job counter is where we expect. Could fail if
        // someone else interacts with our JobEscrow between RecoverJob1 and
        // this run, or if RecoverJob1 hasn't completed yet. Either way we
        // should NOT broadcast - the queued createJob/submit/complete would
        // target the wrong jobId.
        uint256 actualNextJobId = escrow.nextJobId();
        require(
            actualNextJobId == EXPECTED_NEXT_JOB_ID,
            "SmokeTestV2: nextJobId differs from expected - abort and update EXPECTED_NEXT_JOB_ID"
        );
        uint256 expectedNewJobId = EXPECTED_NEXT_JOB_ID + 1;

        // Simulation-only precompile patches (no effect on broadcast txs).
        // See SmokeTest.s.sol for the full explanation.
        vm.mockCall(
            address(0x1800000000000000000000000000000000000001),
            abi.encodeWithSignature("isBlocklisted(address)"),
            abi.encode(false)
        );
        NativeUsdcTransferShim shim = new NativeUsdcTransferShim();
        vm.etch(address(0x1800000000000000000000000000000000000000), address(shim).code);
        vm.allowCheatcodes(address(0x1800000000000000000000000000000000000000));

        uint256 balBefore = usdc.balanceOf(deployer);
        uint256 escrowBalBefore = usdc.balanceOf(JOB_ESCROW);
        uint64 reputationIndexBefore =
            IReputationRegistryRead(REPUTATION_REGISTRY).getLastIndex(OWNED_AGENT_ID, JOB_ESCROW);

        console2.log("============================================");
        console2.log("  SmokeTestV2 - retry with hardcoded agentId");
        console2.log("============================================");
        console2.log("Deployer:                  ", deployer);
        console2.log("agentId (we own):          ", OWNED_AGENT_ID);
        console2.log("Expected new jobId:        ", expectedNewJobId);
        console2.log("USDC bal deployer before:  ", balBefore);
        console2.log("USDC bal escrow before:    ", escrowBalBefore);
        console2.log("Reputation index before:   ", uint256(reputationIndexBefore));
        console2.log("");

        // ══════════════════════════════════════════════════════════════════
        // BROADCAST - 4 transactions, no register().
        //
        // Each external call below becomes its own broadcast tx. None of them
        // depend on a return value from a shared external counter; the only
        // value that flows between them (jobId) is locked in by the
        // EXPECTED_NEXT_JOB_ID assertion above.
        // ══════════════════════════════════════════════════════════════════
        vm.startBroadcast(deployerPk);

        // 1) Approve the escrow to pull exactly 1 USDC.
        usdc.approve(JOB_ESCROW, BOUNTY);

        // 2) Create the job. Returns expectedNewJobId per our pre-flight.
        uint64 deadline = uint64(block.timestamp) + 2 hours;
        uint256 jobId = escrow.createJob(OWNED_AGENT_ID, BOUNTY, deadline);

        // 3) Submit deliverable URI. msg.sender == deployer, deployer owns
        //    OWNED_AGENT_ID, so the contract's ownership check passes.
        escrow.submit(jobId, DELIVERABLE_URI);

        // 4) Accept and complete. Pays 1 USDC to ownerOf(agentId) (= us)
        //    and writes +100 reputation feedback under ("forge-job",
        //    "completed").
        escrow.complete(jobId, bytes32(0));

        vm.stopBroadcast();

        // ══════════════════════════════════════════════════════════════════
        // POST-BROADCAST INVARIANTS - assert reality matches predictions.
        // Same defensive pattern as pre-flight, applied to outputs.
        // ══════════════════════════════════════════════════════════════════
        require(jobId == expectedNewJobId, "SmokeTestV2: actual jobId differs from expectedNewJobId");

        JobEscrow.Job memory job = escrow.getJob(jobId);
        uint64 lastIndex =
            IReputationRegistryRead(REPUTATION_REGISTRY).getLastIndex(OWNED_AGENT_ID, JOB_ESCROW);
        (int128 fbValue, uint8 fbDecimals, string memory fbTag1, string memory fbTag2, bool fbRevoked) =
            IReputationRegistryRead(REPUTATION_REGISTRY).readFeedback(OWNED_AGENT_ID, JOB_ESCROW, lastIndex);

        uint256 balAfter = usdc.balanceOf(deployer);
        uint256 escrowBalAfter = usdc.balanceOf(JOB_ESCROW);

        console2.log("============================================");
        console2.log("  Smoke test V2 results");
        console2.log("============================================");
        console2.log("jobId:                     ", jobId);
        console2.log("");
        console2.log("Job (from JobEscrow.getJob):");
        console2.log("  status (3=Completed):    ", uint256(uint8(job.status)));
        console2.log("  client:                  ", job.client);
        console2.log("  agentId stored:          ", job.agentId);
        console2.log("  bounty:                  ", job.bounty);
        console2.log("  expiredAt:               ", uint256(job.expiredAt));
        console2.log("  deliverableURI:          ", job.deliverableURI);
        console2.log("");
        console2.log("ReputationRegistry feedback @ index:", uint256(lastIndex));
        console2.log("  value (+100 = good):     ", int256(fbValue));
        console2.log("  valueDecimals:           ", uint256(fbDecimals));
        console2.log("  tag1:                    ", fbTag1);
        console2.log("  tag2:                    ", fbTag2);
        console2.log("  isRevoked:               ", fbRevoked);
        console2.log("");
        console2.log("USDC bal deployer after:   ", balAfter);
        console2.log("USDC bal escrow after:     ", escrowBalAfter);
        if (balBefore >= balAfter) {
            console2.log("USDC net spent (gas only): ", balBefore - balAfter);
        } else {
            console2.log("USDC net delta (+):        ", balAfter - balBefore);
        }
        console2.log("============================================");

        require(uint8(job.status) == uint8(JobEscrow.JobStatus.Completed), "SmokeTestV2: job not Completed");
        require(lastIndex == reputationIndexBefore + 1, "SmokeTestV2: reputation index did not advance by 1");
        require(fbValue == 100, "SmokeTestV2: reputation value is not +100");
    }
}
