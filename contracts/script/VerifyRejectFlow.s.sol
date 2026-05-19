// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console2} from "forge-std/Script.sol";
import {Vm} from "forge-std/Vm.sol";
import {JobEscrow} from "../src/JobEscrow.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";

/// @notice Same simulation-only shim as SmokeTest.s.sol — patches Arc's
///         native USDC transfer precompile (0x18…0000) so Foundry's
///         simulator can predict balances without erroring on the
///         unimplemented opcode. No effect on broadcast txs.
contract NativeUsdcTransferShim {
    Vm constant vmCheats = Vm(0x7109709ECfa91a80626fF3989D68f67F5b1DD12D);

    function transfer(address from, address to, uint256 amount) external returns (bool) {
        vmCheats.deal(from, from.balance - amount);
        vmCheats.deal(to, to.balance + amount);
        return true;
    }
}

/**
 * @title  VerifyRejectFlow
 * @notice Phase 5h technical-debt-closure script. Live broadcast
 *         verification of the full Reject path:
 *
 *           approve → createJob → submit → reject
 *
 *         …with belt-and-suspenders hash assertion to PROVE the
 *         frontend's encoding (job-action-dialog.tsx line 395-398)
 *         produces the same bytes32 as Solidity's `keccak256(bytes(text))`
 *         that the contract emits in `JobRejected.reason`.
 *
 *         If the two encodings ever diverge, this script aborts BEFORE
 *         broadcasting any tx — that would be a critical bug we'd want
 *         to fix loudly, not paper over.
 *
 *         Same single-wallet limitation as SmokeTestV2: deployer plays
 *         BOTH client (creator) and agent (owns OWNED_AGENT_ID = 14776).
 *         Net cost = gas; Reject refunds the bounty back to the client
 *         in the same tx.
 *
 * @dev    Verification chain:
 *
 *           1. (Off-chain, viem)  frontend/scripts/reason-encoding-proof.mjs
 *                                 computes keccak256(toBytes("verify-reject-flow-test"))
 *                                 = 0x50cc4355…ede1ed53 (EXPECTED_HASH below)
 *
 *           2. (This script, Solidity)  pre-flight asserts
 *                                       keccak256(bytes(REASON_TEXT)) == EXPECTED_HASH
 *                                       If false → abort, encoding divergence
 *
 *           3. (Broadcast)  passes that hash to reject(); chain emits
 *                           JobRejected(jobId, rejector, reason=that hash)
 *
 *           4. (Post-broadcast)  vm.recordLogs captures the JobRejected log,
 *                                we decode the reason field, assert it == EXPECTED_HASH
 *
 *         Three independent paths arrive at the same bytes32 → encoding
 *         is verified end-to-end frontend ↔ contract.
 *
 * @dev    Usage:
 *           forge script script/VerifyRejectFlow.s.sol:VerifyRejectFlow \
 *             --rpc-url $ARC_RPC_URL --broadcast --skip-simulation --slow -vv
 *
 *         `--skip-simulation` is REQUIRED — Arc's native USDC transfer
 *         precompile breaks Foundry's default pre-broadcast simulation
 *         even with the shim above (the shim helps but isn't perfect).
 *         See SmokeTest.s.sol for the full Arc-precompile explanation.
 *
 *         `--slow` adds inter-tx delays so each broadcast tx mines
 *         before the next one fires. Belt-and-suspenders against
 *         nonce-collision flakes.
 */
contract VerifyRejectFlow is Script {
    // ──────────────────────────────────────────────────────────────────
    // Constants
    // ──────────────────────────────────────────────────────────────────
    uint256 internal constant ARC_TESTNET_CHAIN_ID = 5042002;

    address internal constant USDC = 0x3600000000000000000000000000000000000000;
    address internal constant IDENTITY_REGISTRY = 0x8004A818BFB912233c491871b3d84c89A494BD9e;
    address internal constant JOB_ESCROW = 0x9B02A8BaA84d0B319E5683d9e30838c7D91C414e;

    /// @notice agentId minted to the deployer by SmokeTest v1. Reused
    ///         here so we don't depend on IdentityRegistry's globally
    ///         shared counter (the bug that broke v1). Same as
    ///         SmokeTestV2's OWNED_AGENT_ID.
    uint256 internal constant OWNED_AGENT_ID = 14776;

    /// @notice 0.10 USDC in microUSDC (6 decimals). Smaller than
    ///         SmokeTestV2's 1 USDC — Reject refunds the bounty
    ///         atomically so this is purely a working-capital choice,
    ///         not net cost.
    uint256 internal constant BOUNTY = 100_000;

    string internal constant DELIVERABLE_URI = "ipfs://verify-reject-test";

    /// @notice The reason string the live broadcast will hash. Chosen
    ///         to be unique enough to find in Arcscan event logs after
    ///         the run. Must match the REASON_TEXT used by
    ///         frontend/scripts/reason-encoding-proof.mjs.
    string internal constant REASON_TEXT = "verify-reject-flow-test";

    /// @notice Pre-computed via viem's `keccak256(toBytes("verify-reject-flow-test"))`
    ///         in `frontend/scripts/reason-encoding-proof.mjs`. The
    ///         pre-flight in run() asserts Solidity produces the same
    ///         hash; if not, broadcast aborts.
    bytes32 internal constant EXPECTED_HASH =
        0x50cc4355cf12d85ff8d0660438a1ea1f0cd278e49c77db3dddd83c61ede1ed53;

    function run() external {
        require(block.chainid == ARC_TESTNET_CHAIN_ID, "VerifyRejectFlow: not on Arc testnet");

        uint256 deployerPk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPk);

        JobEscrow escrow = JobEscrow(JOB_ESCROW);
        IERC20 usdc = IERC20(USDC);

        // ══════════════════════════════════════════════════════════════
        // PRE-FLIGHT 1 — Encoding cross-check (the key Phase 5h verifier).
        //
        // viem's `keccak256(toBytes(s))` and Solidity's `keccak256(bytes(s))`
        // MUST produce identical output for the same UTF-8 string s.
        // Both libraries hash the underlying byte sequence with no
        // length prefix or framing. If this assertion fails, something
        // is structurally wrong (corrupted constant, mis-pasted hash,
        // viem regression) and we should NOT broadcast.
        // ══════════════════════════════════════════════════════════════
        bytes32 solidityHash = keccak256(bytes(REASON_TEXT));
        require(
            solidityHash == EXPECTED_HASH,
            "VerifyRejectFlow: Solidity keccak256 != EXPECTED_HASH (frontend/contract encoding divergence)"
        );

        // ══════════════════════════════════════════════════════════════
        // PRE-FLIGHT 2 — Agent ownership intact.
        // ══════════════════════════════════════════════════════════════
        address agentOwner = IERC721(IDENTITY_REGISTRY).ownerOf(OWNED_AGENT_ID);
        require(
            agentOwner == deployer,
            "VerifyRejectFlow: deployer no longer owns OWNED_AGENT_ID"
        );

        // ══════════════════════════════════════════════════════════════
        // PRE-FLIGHT 3 — Sufficient USDC for bounty.
        //
        // We need >= BOUNTY upfront. Refund returns it, but the bounty
        // must be funded before createJob completes.
        // ══════════════════════════════════════════════════════════════
        uint256 balBefore = usdc.balanceOf(deployer);
        require(balBefore >= BOUNTY, "VerifyRejectFlow: deployer USDC balance < BOUNTY");

        // ══════════════════════════════════════════════════════════════
        // PRE-FLIGHT 4 — Snapshot nextJobId.
        //
        // We use the snapshot value (NOT createJob's return value) for
        // submit/reject args, mirroring SmokeTestV2's hardening against
        // the Foundry-script-simulation-bake-in pitfall.
        //
        // ⚠️ CRITICAL: nextJobId() returns the LAST-USED id; createJob
        //    produces jobId == nextJobId + 1. The first version of this
        //    script omitted the `+ 1` and called submit(N)/reject(N)
        //    against the previous job (not ours), which reverted on
        //    NotClient. See SmokeTestV2 line 150 (`expectedNewJobId =
        //    EXPECTED_NEXT_JOB_ID + 1`) for the same pattern.
        // ══════════════════════════════════════════════════════════════
        uint256 expectedJobId = escrow.nextJobId() + 1;

        // Simulation-only precompile shims. No effect on broadcast txs.
        vm.mockCall(
            address(0x1800000000000000000000000000000000000001),
            abi.encodeWithSignature("isBlocklisted(address)"),
            abi.encode(false)
        );
        NativeUsdcTransferShim shim = new NativeUsdcTransferShim();
        vm.etch(address(0x1800000000000000000000000000000000000000), address(shim).code);
        vm.allowCheatcodes(address(0x1800000000000000000000000000000000000000));

        console2.log("==================================================");
        console2.log("  VerifyRejectFlow - Phase 5h live broadcast");
        console2.log("==================================================");
        console2.log("Deployer:                  ", deployer);
        console2.log("agentId (we own):          ", OWNED_AGENT_ID);
        console2.log("Expected new jobId:        ", expectedJobId);
        console2.log("Bounty (microUSDC):        ", BOUNTY);
        console2.log("Deliverable URI:           ", DELIVERABLE_URI);
        console2.log("Reason text:               ", REASON_TEXT);
        console2.log("EXPECTED_HASH (frontend):");
        console2.logBytes32(EXPECTED_HASH);
        console2.log("solidityHash (this script):");
        console2.logBytes32(solidityHash);
        console2.log("Encoding match: PASS (pre-broadcast assertion held)");
        console2.log("USDC bal deployer before:  ", balBefore);
        console2.log("");

        // ══════════════════════════════════════════════════════════════
        // BROADCAST - 4 transactions.
        //
        // vm.recordLogs() captures all events emitted during the
        // simulated execution leading up to the broadcast — including
        // JobRejected. Foundry uses the same deterministic emission
        // when actually broadcasting, so the captured reason will
        // equal the on-chain reason.
        // ══════════════════════════════════════════════════════════════
        vm.recordLogs();
        vm.startBroadcast(deployerPk);

        // 1. Approve USDC for exact bounty (matches dialog's UX pattern).
        usdc.approve(JOB_ESCROW, BOUNTY);

        // 2. Create the job. We ignore the return value and use the
        //    pre-flight snapshot below — defensive against the v1
        //    simulation-bake-in trap.
        uint64 deadline = uint64(block.timestamp) + 24 hours;
        escrow.createJob(OWNED_AGENT_ID, BOUNTY, deadline);

        // 3. Submit (deployer owns agent NFT 14776, so msg.sender is
        //    the legitimate provider).
        escrow.submit(expectedJobId, DELIVERABLE_URI);

        // 4. Reject (deployer is the client — only the client can reject).
        //    We pass solidityHash directly; the contract emits it verbatim
        //    in JobRejected.reason and stores it in ReputationRegistry.feedbackHash.
        escrow.reject(expectedJobId, solidityHash);

        vm.stopBroadcast();

        // ══════════════════════════════════════════════════════════════
        // POST-BROADCAST - read state back and assert invariants.
        // ══════════════════════════════════════════════════════════════
        JobEscrow.Job memory job = escrow.getJob(expectedJobId);
        uint256 balAfter = usdc.balanceOf(deployer);

        // Walk the recorded logs to find JobRejected and decode the
        // reason field. JobRejected has signature
        // (uint256 indexed jobId, address indexed rejector, bytes32 reason)
        // → reason lives in `data`, not topics.
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bytes32 jobRejectedSig = keccak256("JobRejected(uint256,address,bytes32)");
        bytes32 emittedReason = bytes32(0);
        bool found = false;
        for (uint256 i = 0; i < logs.length; i++) {
            if (
                logs[i].emitter == JOB_ESCROW &&
                logs[i].topics.length >= 3 &&
                logs[i].topics[0] == jobRejectedSig &&
                uint256(logs[i].topics[1]) == expectedJobId
            ) {
                emittedReason = abi.decode(logs[i].data, (bytes32));
                found = true;
                break;
            }
        }

        console2.log("==================================================");
        console2.log("  Results");
        console2.log("==================================================");
        console2.log("jobId:                     ", expectedJobId);
        console2.log("Job status (4=Rejected):   ", uint256(uint8(job.status)));
        console2.log("Job client:                ", job.client);
        console2.log("Job agentId stored:        ", job.agentId);
        console2.log("Job bounty:                ", job.bounty);
        console2.log("Job deliverableURI:        ", job.deliverableURI);
        console2.log("");
        console2.log("JobRejected event found:   ", found);
        console2.log("Emitted reason bytes32:");
        console2.logBytes32(emittedReason);
        console2.log("");
        console2.log("USDC bal deployer after:   ", balAfter);
        if (balBefore >= balAfter) {
            console2.log("Net spent (gas only):      ", balBefore - balAfter);
        } else {
            console2.log("Net delta (+, unexpected): ", balAfter - balBefore);
        }
        console2.log("==================================================");

        // ── Final invariants ─────────────────────────────────────────
        require(
            uint8(job.status) == uint8(JobEscrow.JobStatus.Rejected),
            "VerifyRejectFlow: job not in Rejected state"
        );
        require(found, "VerifyRejectFlow: JobRejected event not found in recorded logs");
        require(
            emittedReason == EXPECTED_HASH,
            "VerifyRejectFlow: emitted reason != EXPECTED_HASH (frontend hash mismatch)"
        );
        require(
            emittedReason == solidityHash,
            "VerifyRejectFlow: emitted reason != local Solidity hash"
        );
    }
}
