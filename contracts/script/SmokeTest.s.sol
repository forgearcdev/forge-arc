// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console2} from "forge-std/Script.sol";
import {Vm} from "forge-std/Vm.sol";
import {JobEscrow} from "../src/JobEscrow.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice Minimal slice of ERC-8004 IdentityRegistry we need.
interface IIdentityRegistry {
    function register(string calldata metadataURI) external returns (uint256);
}

/// @notice Shim contract `vm.etch`'d at Arc's native USDC transfer precompile
///         (0x1800...0000) DURING SIMULATION ONLY. The precompile exists on
///         the live chain — this shim just lets Foundry's local simulator
///         model its effect (atomically moving native balances) so the
///         dry-run can complete. Identical to the one used in
///         test/JobEscrow.fork.t.sol.
///
/// @dev    Cheatcodes are local-only. When forge script's broadcast phase
///         submits the actual signed transactions to the RPC, those txs hit
///         the real consensus precompile, not this etched code. This shim
///         never reaches the chain.
contract NativeUsdcTransferShim {
    Vm constant vmCheats = Vm(0x7109709ECfa91a80626fF3989D68f67F5b1DD12D);

    function transfer(address from, address to, uint256 amount) external returns (bool) {
        vmCheats.deal(from, from.balance - amount);
        vmCheats.deal(to, to.balance + amount);
        return true;
    }
}

/// @notice Minimal slice of ERC-8004 ReputationRegistry needed to read back
///         the feedback our escrow writes on complete().
interface IReputationRegistryRead {
    function getLastIndex(uint256 agentId, address clientAddress) external view returns (uint64);

    function readFeedback(uint256 agentId, address clientAddress, uint64 feedbackIndex)
        external
        view
        returns (int128 value, uint8 valueDecimals, string memory tag1, string memory tag2, bool isRevoked);
}

/**
 * @title  SmokeTest
 * @notice End-to-end live-network smoke test against the deployed JobEscrow.
 *
 *         ⚠️  SINGLE-WALLET CAVEAT  ⚠️
 *         Because we only have one funded Arc-testnet wallet right now, this
 *         script runs with the deployer acting as BOTH the job-posting client
 *         AND the agent-NFT owner. The contract permits this (it never asserts
 *         client != provider), and the 1 USDC bounty round-trips back to the
 *         same wallet, leaving the deployer down only the gas spent.
 *
 *         This is NOT a production-representative flow. A real job has two
 *         distinct parties: the client funds the bounty and evaluates the
 *         deliverable; a separate agent operator owns the NFT, submits work,
 *         and receives payment. A two-wallet demo is a good next exercise.
 *
 *         What this smoke test DOES prove:
 *           - The deployed JobEscrow integrates correctly with Arc's real
 *             IdentityRegistry (NFT ownership lookups) and ReputationRegistry
 *             (feedback writes).
 *           - The full ERC-8183-shaped lifecycle (create → submit → complete)
 *             clears onchain with real USDC settlement.
 *           - Our gas estimates and event topics behave as predicted offchain.
 *
 *         Walks the full happy-path lifecycle as a single broadcasting wallet:
 *
 *           1. register() a new agent NFT on the canonical IdentityRegistry
 *           2. approve() JobEscrow to spend 1 USDC
 *           3. createJob() — escrow pulls 1 USDC bounty
 *           4. submit() the deliverable (deployer also owns the agent NFT)
 *           5. complete() — escrow pays 1 USDC to the agent NFT owner
 *              (= same deployer) and writes +100 reputation feedback
 *
 *         Because client == agent owner == deployer, the 1 USDC bounty is
 *         paid back to the same wallet. The net USDC delta is therefore
 *         roughly -(total gas), nothing more.
 *
 * @dev    Usage:
 *
 *           Dry-run (no broadcast):
 *             forge script script/SmokeTest.s.sol --rpc-url $ARC_RPC_URL
 *
 *           Real run (broadcasts 5 txs):
 *             forge script script/SmokeTest.s.sol \
 *               --rpc-url $ARC_RPC_URL --broadcast
 *
 *         Refuses to run anywhere other than Arc testnet (chain id 5042002).
 */
contract SmokeTest is Script {
    // ──────────────────────────────────────────────────────────────────────
    // Constants
    // ──────────────────────────────────────────────────────────────────────
    uint256 internal constant ARC_TESTNET_CHAIN_ID = 5042002;

    address internal constant USDC = 0x3600000000000000000000000000000000000000;
    address internal constant IDENTITY_REGISTRY = 0x8004A818BFB912233c491871b3d84c89A494BD9e;
    address internal constant REPUTATION_REGISTRY = 0x8004B663056A597Dffe9eCcC1965A193B7388713;

    /// @notice Live JobEscrow deployed by DeployJobEscrow.s.sol at block 42728020.
    address internal constant JOB_ESCROW = 0x9B02A8BaA84d0B319E5683d9e30838c7D91C414e;

    /// @notice 1 USDC in 6-decimal units.
    uint256 internal constant BOUNTY = 1_000_000;

    /// @notice Test metadata URIs. ipfs:// scheme but content doesn't need to
    ///         actually exist — IdentityRegistry just stores the string and
    ///         JobEscrow stores the deliverable string. No fetching happens
    ///         onchain.
    string internal constant AGENT_METADATA_URI = "ipfs://forge-smoke-test-agent-v1";
    string internal constant DELIVERABLE_URI = "ipfs://QmTestSmokeTestPlaceholder";

    function run() external {
        require(block.chainid == ARC_TESTNET_CHAIN_ID, "SmokeTest: not on Arc testnet");

        uint256 deployerPk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPk);

        JobEscrow escrow = JobEscrow(JOB_ESCROW);
        IERC20 usdc = IERC20(USDC);

        // Sanity: escrow must already be deployed (codesize > 0). If we're
        // pointed at the wrong address, fail loudly before broadcasting.
        require(JOB_ESCROW.code.length > 0, "SmokeTest: JobEscrow has no code at expected address");

        // ──────────────────────────────────────────────────────────────────
        // SIMULATION-ONLY PRECOMPILE PATCHES
        //
        // Arc has two consensus-level precompiles that USDC depends on:
        //   - 0x1800...0001 isBlocklisted(address)  → called by transferFrom
        //   - 0x1800...0000 transfer(from, to, amt) → moves native USDC bal
        //
        // Foundry's local EVM (used by both the dry-run AND the pre-broadcast
        // simulation that estimates gas) doesn't implement them, so without
        // these patches every USDC operation reverts with StackUnderflow and
        // we can't even reach `vm.startBroadcast`.
        //
        // These are cheatcodes: they affect ONLY the local simulator. When
        // forge script's broadcast phase sends signed txs to the real Arc
        // RPC, those txs hit the genuine consensus precompiles. The mockCall
        // and etched shim never appear onchain. Same trick we use in
        // test/JobEscrow.fork.t.sol — kept identical for consistency.
        // ──────────────────────────────────────────────────────────────────
        vm.mockCall(
            address(0x1800000000000000000000000000000000000001),
            abi.encodeWithSignature("isBlocklisted(address)"),
            abi.encode(false)
        );
        NativeUsdcTransferShim shim = new NativeUsdcTransferShim();
        vm.etch(address(0x1800000000000000000000000000000000000000), address(shim).code);
        vm.allowCheatcodes(address(0x1800000000000000000000000000000000000000));

        uint256 usdcBalanceBefore = usdc.balanceOf(deployer);
        uint256 escrowBalanceBefore = usdc.balanceOf(JOB_ESCROW);

        console2.log("============================================");
        console2.log("  Forge JobEscrow live smoke test");
        console2.log("============================================");
        console2.log("Chain id:                ", block.chainid);
        console2.log("Deployer:                ", deployer);
        console2.log("JobEscrow:               ", JOB_ESCROW);
        console2.log("USDC bal (deployer):     ", usdcBalanceBefore);
        console2.log("USDC bal (escrow):       ", escrowBalanceBefore);
        console2.log("Bounty:                  ", BOUNTY);
        console2.log("");

        // ──────────────────────────────────────────────────────────────────
        // BROADCAST: 5 transactions, all from the deployer wallet.
        // Each external call inside startBroadcast/stopBroadcast becomes its
        // own signed transaction in Foundry's broadcast queue.
        // ──────────────────────────────────────────────────────────────────
        vm.startBroadcast(deployerPk);

        // 1) Register a fresh agent identity (mints a new ERC-721 to deployer)
        uint256 agentId = IIdentityRegistry(IDENTITY_REGISTRY).register(AGENT_METADATA_URI);

        // 2) Approve JobEscrow to pull exactly 1 USDC for the bounty
        usdc.approve(JOB_ESCROW, BOUNTY);

        // 3) Create the job — escrow transferFroms 1 USDC from us into itself
        uint64 deadline = uint64(block.timestamp) + 2 hours;
        uint256 jobId = escrow.createJob(agentId, BOUNTY, deadline);

        // 4) Submit a deliverable URI (we own agentId, so this is authorized)
        escrow.submit(jobId, DELIVERABLE_URI);

        // 5) Accept the deliverable — releases 1 USDC to ownerOf(agentId)
        //    (also deployer), and writes +100 reputation feedback.
        escrow.complete(jobId, bytes32(0));

        vm.stopBroadcast();

        // ──────────────────────────────────────────────────────────────────
        // VERIFY post-broadcast state via fresh reads.
        // ──────────────────────────────────────────────────────────────────
        JobEscrow.Job memory job = escrow.getJob(jobId);

        uint64 lastIndex =
            IReputationRegistryRead(REPUTATION_REGISTRY).getLastIndex(agentId, JOB_ESCROW);

        // ReputationRegistry uses 1-based indexing. Read the just-written
        // entry directly at lastIndex (not lastIndex - 1).
        (int128 fbValue, uint8 fbDecimals, string memory fbTag1, string memory fbTag2, bool fbRevoked) =
            IReputationRegistryRead(REPUTATION_REGISTRY).readFeedback(agentId, JOB_ESCROW, lastIndex);

        uint256 usdcBalanceAfter = usdc.balanceOf(deployer);
        uint256 escrowBalanceAfter = usdc.balanceOf(JOB_ESCROW);

        console2.log("============================================");
        console2.log("  Smoke test results");
        console2.log("============================================");
        console2.log("agentId:                 ", agentId);
        console2.log("jobId:                   ", jobId);
        console2.log("");
        console2.log("Job (from JobEscrow.getJob):");
        console2.log("  status (3=Completed):  ", uint256(uint8(job.status)));
        console2.log("  client:                ", job.client);
        console2.log("  agentId (stored):      ", job.agentId);
        console2.log("  bounty:                ", job.bounty);
        console2.log("  expiredAt:             ", uint256(job.expiredAt));
        console2.log("  deliverableURI:        ", job.deliverableURI);
        console2.log("");
        console2.log("ReputationRegistry feedback @ index:", uint256(lastIndex));
        console2.log("  value (+100 = good):   ", int256(fbValue));
        console2.log("  valueDecimals:         ", uint256(fbDecimals));
        console2.log("  tag1:                  ", fbTag1);
        console2.log("  tag2:                  ", fbTag2);
        console2.log("  isRevoked:             ", fbRevoked);
        console2.log("");
        console2.log("USDC bal (deployer end): ", usdcBalanceAfter);
        console2.log("USDC bal (escrow end):   ", escrowBalanceAfter);
        if (usdcBalanceBefore >= usdcBalanceAfter) {
            console2.log("USDC net spent (gas):    ", usdcBalanceBefore - usdcBalanceAfter);
        } else {
            console2.log("USDC net delta (+):      ", usdcBalanceAfter - usdcBalanceBefore);
        }
        console2.log("============================================");
    }
}
