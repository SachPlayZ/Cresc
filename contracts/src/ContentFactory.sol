// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

import {ContentVault} from "contracts/src/ContentVault.sol";

/**
 * @title Cresc ContentFactory
 * @notice Deploys one ContentVault per Ghost content id.
 * @custom:security-contact security@cresc.app
 */
contract ContentFactory {
    address private immutable USDC;
    address public owner;
    address public pendingOwner;
    mapping(bytes32 contentId => address contentContract) public contentContracts;

    event ContentCreated(
        bytes32 indexed contentId,
        address indexed contentContract,
        address indexed creator,
        uint256 initialPriceAtomic,
        string metadataURI,
        address priceTuner
    );
    event OwnershipTransferStarted(address indexed currentOwner, address indexed pendingOwner);
    event OwnershipTransferred(address indexed oldOwner, address indexed newOwner);

    error ContentFactory__ZeroAddress();
    error ContentFactory__Unauthorized();
    error ContentFactory__AlreadyExists();

    constructor(address usdc_, address owner_) {
        if (usdc_ == address(0) || owner_ == address(0)) revert ContentFactory__ZeroAddress();
        USDC = usdc_;
        owner = owner_;
    }

    /*//////////////////////////////////////////////////////////////
                 USER-FACING STATE-CHANGING FUNCTIONS
    //////////////////////////////////////////////////////////////*/

    function createContent(
        bytes32 contentId,
        string calldata creatorId,
        address creator,
        uint256 initialPriceAtomic,
        string calldata metadataURI,
        bytes32 metadataHash,
        address priceTuner
    ) external returns (address contentContract) {
        if (msg.sender != owner) revert ContentFactory__Unauthorized();
        if (creator == address(0) || priceTuner == address(0)) revert ContentFactory__ZeroAddress();
        if (contentContracts[contentId] != address(0)) revert ContentFactory__AlreadyExists();

        contentContract = address(
            new ContentVault(
                contentId, creatorId, creator, USDC, initialPriceAtomic, metadataURI, metadataHash, priceTuner
            )
        );
        contentContracts[contentId] = contentContract;

        emit ContentCreated(contentId, contentContract, creator, initialPriceAtomic, metadataURI, priceTuner);
    }

    function transferOwnership(address newOwner) external {
        if (msg.sender != owner) revert ContentFactory__Unauthorized();
        if (newOwner == address(0)) revert ContentFactory__ZeroAddress();
        pendingOwner = newOwner;
        emit OwnershipTransferStarted(msg.sender, newOwner);
    }

    function acceptOwnership() external {
        if (msg.sender != pendingOwner) revert ContentFactory__Unauthorized();
        address oldOwner = owner;
        owner = msg.sender;
        pendingOwner = address(0);
        emit OwnershipTransferred(oldOwner, msg.sender);
    }

    /*//////////////////////////////////////////////////////////////
                      USER-FACING READ-ONLY FUNCTIONS
    //////////////////////////////////////////////////////////////*/

    function usdc() external view returns (address token) {
        token = USDC;
    }
}
