// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import {ContentFactory} from "contracts/src/ContentFactory.sol";

interface Vm {
    function envAddress(string calldata key) external view returns (address);
    function startBroadcast() external;
    function stopBroadcast() external;
}

/**
 * @notice Deploys Cresc ContentFactory.
 * @dev Use `forge script ... --account <keystore-account> --sender <sender> --broadcast`.
 *      Do not pass private keys through env vars.
 */
contract DeployContentFactory {
    Vm private constant VM = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    function run() external returns (ContentFactory factory) {
        address usdc = VM.envAddress("USDC_ADDRESS");
        address owner = VM.envAddress("CONTENT_FACTORY_OWNER");

        VM.startBroadcast();
        factory = new ContentFactory(usdc, owner);
        VM.stopBroadcast();
    }
}
