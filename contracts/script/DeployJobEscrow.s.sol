// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console2} from "forge-std/Script.sol";
import {JobEscrow, IReputationRegistry} from "../src/JobEscrow.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";

/**
 * @title  DeployJobEscrow
 * @notice One-shot deploy script for JobEscrow. Reads constructor args
 *         from /contracts/.env and refuses to deploy outside Arc testnet.
 *
 * @dev    Usage:
 *           Dry-run (simulation only, no broadcast):
 *             forge script script/DeployJobEscrow.s.sol --rpc-url $ARC_RPC_URL
 *
 *           Real deploy (broadcasts the tx):
 *             forge script script/DeployJobEscrow.s.sol \
 *               --rpc-url $ARC_RPC_URL --broadcast
 *
 *         The deployed address is logged and also persisted automatically
 *         by Foundry under contracts/broadcast/DeployJobEscrow.s.sol/<chainId>/
 *         after a successful broadcast.
 */
contract DeployJobEscrow is Script {
    /// @notice Arc testnet chain id. The script will revert on any other chain.
    uint256 internal constant ARC_TESTNET_CHAIN_ID = 5042002;

    function run() external returns (address deployed) {
        // Safety: refuse to deploy outside Arc testnet. Prevents accidental
        // mainnet deployment if ARC_RPC_URL is misconfigured.
        require(block.chainid == ARC_TESTNET_CHAIN_ID, "DeployJobEscrow: not on Arc testnet");

        // Read all constructor args from .env. vm.envAddress reverts with a
        // clear message if the var is missing, so a misconfigured .env
        // surfaces immediately rather than silently using address(0).
        uint256 deployerPk = vm.envUint("PRIVATE_KEY");
        address usdc = vm.envAddress("USDC_ADDRESS");
        address identityRegistry = vm.envAddress("IDENTITY_REGISTRY_ADDRESS");
        address reputationRegistry = vm.envAddress("REPUTATION_REGISTRY_ADDRESS");
        address deployer = vm.addr(deployerPk);

        // Pre-flight summary, printed before broadcast. In a dry-run this is
        // all you see; in a real broadcast this prints first, then Foundry
        // prints the actual tx hash and gas after the broadcast block.
        console2.log("============================================");
        console2.log("  Forge JobEscrow deployment");
        console2.log("============================================");
        console2.log("Chain id:               ", block.chainid);
        console2.log("Deployer address:       ", deployer);
        console2.log("Deployer USDC balance:  ", IERC20(usdc).balanceOf(deployer));
        console2.log("");
        console2.log("Constructor args:");
        console2.log("  _usdc:               ", usdc);
        console2.log("  _identityRegistry:   ", identityRegistry);
        console2.log("  _reputationRegistry: ", reputationRegistry);
        console2.log("============================================");

        vm.startBroadcast(deployerPk);
        JobEscrow escrow = new JobEscrow(
            IERC20(usdc),
            IERC721(identityRegistry),
            IReputationRegistry(reputationRegistry)
        );
        vm.stopBroadcast();

        console2.log("");
        console2.log("============================================");
        console2.log("  Deployed");
        console2.log("============================================");
        console2.log("JobEscrow address:      ", address(escrow));
        console2.log(string.concat(
            "Explorer: https://testnet.arcscan.app/address/",
            vm.toString(address(escrow))
        ));
        console2.log("============================================");

        return address(escrow);
    }
}
