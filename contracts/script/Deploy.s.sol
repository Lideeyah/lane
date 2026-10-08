// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {TillRegistry} from "../src/TillRegistry.sol";
import {MockUSD} from "../src/MockUSD.sol";

/// @notice Deploys the registry. On the local dev chain (31337) it also deploys
///         a mock stablecoin and funds a customer account for end-to-end testing.
contract Deploy is Script {
    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        vm.startBroadcast(pk);
        TillRegistry reg = new TillRegistry();
        console.log("TILL_REGISTRY", address(reg));

        if (block.chainid == 31337) {
            MockUSD usd = new MockUSD();
            console.log("TOKEN", address(usd));
            address customer = vm.envOr("DEV_CUSTOMER", address(0));
            if (customer != address(0)) {
                usd.mint(customer, 10_000 * 1e6);
                console.log("MINTED_TO", customer);
            }
        }
        vm.stopBroadcast();
    }
}
