// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console2} from "forge-std/Script.sol";
import {Vm} from "forge-std/Vm.sol";
import {JobEscrow} from "../src/JobEscrow.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice Same simulation-only shim as SmokeTest.s.sol - see that file for
///         the full explanation of why Foundry's local EVM needs this patch
///         in order to model Arc's native USDC transfer precompile.
contract NativeUsdcTransferShim {
    Vm constant vmCheats = Vm(0x7109709ECfa91a80626fF3989D68f67F5b1DD12D);

    function transfer(address from, address to, uint256 amount) external returns (bool) {
        vmCheats.deal(from, from.balance - amount);
        vmCheats.deal(to, to.balance + amount);
        return true;
    }
}

/**
 * @title  RecoverJob1
 * @notice One-shot recovery script for the orphaned jobId=1 created by the
 *         failed SmokeTest broadcast. Calls JobEscrow.claimRefund(1) once
 *         the deadline has passed, returning the 1 USDC bounty to the
 *         original client (deployer).
 *
 * @dev    Background - what went wrong in SmokeTest v1:
 *           The script's local fork simulation predicted IdentityRegistry
 *           would mint agentId 14775 to the deployer, and that value was
 *           baked into all downstream tx calldata. Between simulation and
 *           broadcast, a third party registered an agent on the public
 *           registry, advancing the counter by 1. Our register() call
 *           actually minted 14776, but createJob(14775, …) had already been
 *           queued, so we ended up funding a job pointed at someone else's
 *           agent NFT. submit() then reverted with NotAgentOwner.
 *
 *         The job is recoverable: claimRefund is permissionless and pays
 *         the original client. The contract just requires the deadline to
 *         have passed and the status to be Funded or Submitted.
 *
 * @dev    Pre-flight assertions abort the run if reality has already
 *         diverged from what we expect (e.g. someone else already refunded
 *         job 1 between when we wrote this script and when we broadcast it,
 *         in which case the funds are already back and we just wasted gas).
 *
 * @dev    Usage:
 *
 *           Dry-run (simulation only):
 *             forge script script/RecoverJob1.s.sol:RecoverJob1 \
 *               --rpc-url $ARC_RPC_URL --skip-simulation
 *
 *           Broadcast (after expiredAt = 1779057483 = Sun May 17 22:38:03 UTC 2026):
 *             forge script script/RecoverJob1.s.sol:RecoverJob1 \
 *               --rpc-url $ARC_RPC_URL --broadcast --skip-simulation
 */
contract RecoverJob1 is Script {
    uint256 internal constant ARC_TESTNET_CHAIN_ID = 5042002;

    address internal constant USDC = 0x3600000000000000000000000000000000000000;
    address internal constant JOB_ESCROW = 0x9B02A8BaA84d0B319E5683d9e30838c7D91C414e;

    /// @notice The orphaned jobId from the failed SmokeTest v1 broadcast.
    uint256 internal constant STUCK_JOB_ID = 1;

    function run() external {
        require(block.chainid == ARC_TESTNET_CHAIN_ID, "RecoverJob1: not on Arc testnet");

        uint256 deployerPk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPk);

        JobEscrow escrow = JobEscrow(JOB_ESCROW);
        IERC20 usdc = IERC20(USDC);

        // ──────────────────────────────────────────────────────────────────
        // PRE-FLIGHT - verify the chain state still matches our expectations
        // before broadcasting. Any divergence here means our predictions are
        // wrong and we should abort, not blast through.
        // ──────────────────────────────────────────────────────────────────
        JobEscrow.Job memory job = escrow.getJob(STUCK_JOB_ID);

        // 1. Status must be Funded (= 1). The failed broadcast left us here.
        //    If someone else already called claimRefund, status would be
        //    Expired (= 5) and the funds are already home - no work needed.
        require(
            uint8(job.status) == uint8(JobEscrow.JobStatus.Funded),
            "RecoverJob1: job 1 status is not Funded - already refunded?"
        );

        // 2. Caller must be the recorded client. claimRefund is permissionless
        //    but the bounty is always sent back to job.client; running this
        //    from a non-client wallet would just spend gas to pay someone
        //    else's refund.
        require(job.client == deployer, "RecoverJob1: deployer is not the job's client");

        // 3. Deadline must have passed. claimRefund reverts with NotYetExpired
        //    otherwise; we'd rather give a clearer error here.
        require(
            block.timestamp >= job.expiredAt,
            "RecoverJob1: deadline has not passed yet - wait until expiredAt"
        );

        // Simulation-only precompile patches (no effect on broadcast txs).
        // See SmokeTest.s.sol for full explanation.
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

        console2.log("============================================");
        console2.log("  RecoverJob1 - reclaim escrowed bounty");
        console2.log("============================================");
        console2.log("Chain id:                  ", block.chainid);
        console2.log("Deployer:                  ", deployer);
        console2.log("JobEscrow:                 ", JOB_ESCROW);
        console2.log("Job ID:                    ", STUCK_JOB_ID);
        console2.log("Job bounty (USDC mu):      ", job.bounty);
        console2.log("Job expiredAt (unix):      ", uint256(job.expiredAt));
        console2.log("block.timestamp (unix):    ", block.timestamp);
        console2.log("USDC bal deployer before:  ", balBefore);
        console2.log("USDC bal escrow before:    ", escrowBalBefore);
        console2.log("");

        // ──────────────────────────────────────────────────────────────────
        // BROADCAST - single tx: claimRefund(1)
        // ──────────────────────────────────────────────────────────────────
        vm.startBroadcast(deployerPk);
        escrow.claimRefund(STUCK_JOB_ID);
        vm.stopBroadcast();

        // ──────────────────────────────────────────────────────────────────
        // POST-CHECK - verify final state.
        // ──────────────────────────────────────────────────────────────────
        JobEscrow.Job memory jobAfter = escrow.getJob(STUCK_JOB_ID);
        uint256 balAfter = usdc.balanceOf(deployer);
        uint256 escrowBalAfter = usdc.balanceOf(JOB_ESCROW);

        console2.log("============================================");
        console2.log("  Refund completed");
        console2.log("============================================");
        console2.log("Job status after (5=Exp):  ", uint256(uint8(jobAfter.status)));
        console2.log("USDC bal deployer after:   ", balAfter);
        console2.log("USDC bal escrow after:     ", escrowBalAfter);
        // Refund pays bounty back to client, then deployer spends gas. So
        // balAfter should be roughly balBefore + bounty - gas. We don't know
        // exact gas here; print both sides and let the reporting layer math.
        if (balAfter >= balBefore) {
            console2.log("USDC net delta (+):        ", balAfter - balBefore);
        } else {
            console2.log("USDC net delta (-):        ", balBefore - balAfter);
        }
        console2.log("Arcscan (JobEscrow):       https://testnet.arcscan.app/address/0x9B02A8BaA84d0B319E5683d9e30838c7D91C414e");
        console2.log("============================================");

        require(
            uint8(jobAfter.status) == uint8(JobEscrow.JobStatus.Expired),
            "RecoverJob1: post-refund status is not Expired"
        );
    }
}
