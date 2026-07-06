// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import {ContentFactory} from "contracts/src/ContentFactory.sol";
import {ContentVault} from "contracts/src/ContentVault.sol";

interface Vm {
    function prank(address msgSender) external;
    function expectRevert(bytes4 revertData) external;
    function addr(uint256 privateKey) external returns (address);
    function sign(uint256 privateKey, bytes32 digest) external returns (uint8 v, bytes32 r, bytes32 s);
}

contract MockUSDC {
    mapping(address account => uint256 balance) public balanceOf;

    function mint(address to, uint256 value) external {
        balanceOf[to] += value;
    }

    function transfer(address to, uint256 value) external returns (bool) {
        if (balanceOf[msg.sender] < value) return false;
        balanceOf[msg.sender] -= value;
        balanceOf[to] += value;
        return true;
    }
}

contract ContentFactoryTest {
    Vm private constant VM = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    uint256 private constant CREATOR_PK = 0xA11CE5EED;
    address private constant OWNER = address(0xA11CE);
    address private constant TUNER = address(0xCAFE);
    address private constant PAYOUT = address(0xD00D);
    address private constant DESTINATION = address(0xF00D);

    address private CREATOR;
    MockUSDC private usdc;
    ContentFactory private factory;

    function setUp() external {
        CREATOR = VM.addr(CREATOR_PK);
        usdc = new MockUSDC();
        factory = new ContentFactory(address(usdc), OWNER);
    }

    function testCreateContentStoresCreatorIdentityAndMetadata() external {
        bytes32 contentId = keccak256("creator-a:post-a");
        bytes32 metadataHash = keccak256("metadata");

        VM.prank(OWNER);
        address contentContract = factory.createContent(
            contentId, "creator-a", CREATOR, 50_000, "cresc://ghost/creator-a/post-a", metadataHash, TUNER
        );

        ContentVault vault = ContentVault(contentContract);
        assert(factory.contentContracts(contentId) == contentContract);
        assert(vault.contentId() == contentId);
        assert(keccak256(bytes(vault.creatorId())) == keccak256("creator-a"));
        assert(vault.creator() == CREATOR);
        assert(vault.priceTuner() == TUNER);
        assert(vault.payoutOperator() == TUNER);
        assert(vault.priceAtomic() == 50_000);
        assert(vault.metadataHash() == metadataHash);
        assert(vault.active());
        assert(vault.withdrawNonce() == 0);
    }

    function testCreateContentRevertsWhenCallerIsNotOwner() external {
        bytes32 contentId = keccak256("creator-a:post-a");

        VM.expectRevert(ContentFactory.ContentFactory__Unauthorized.selector);
        factory.createContent(
            contentId, "creator-a", CREATOR, 50_000, "cresc://ghost/creator-a/post-a", bytes32(0), TUNER
        );
    }

    function testCreateContentRevertsOnDuplicateContentId() external {
        bytes32 contentId = keccak256("creator-a:post-a");

        VM.prank(OWNER);
        factory.createContent(contentId, "creator-a", CREATOR, 50_000, "uri", bytes32(0), TUNER);

        VM.prank(OWNER);
        VM.expectRevert(ContentFactory.ContentFactory__AlreadyExists.selector);
        factory.createContent(contentId, "creator-a", CREATOR, 50_000, "uri", bytes32(0), TUNER);
    }

    function testTransferOwnershipTwoStep() external {
        address newOwner = address(0xB00B);

        VM.expectRevert(ContentFactory.ContentFactory__Unauthorized.selector);
        factory.transferOwnership(newOwner);

        VM.prank(OWNER);
        factory.transferOwnership(newOwner);
        assert(factory.pendingOwner() == newOwner);
        assert(factory.owner() == OWNER);

        VM.expectRevert(ContentFactory.ContentFactory__Unauthorized.selector);
        factory.acceptOwnership();

        VM.prank(newOwner);
        factory.acceptOwnership();
        assert(factory.owner() == newOwner);
        assert(factory.pendingOwner() == address(0));
    }

    function testTunePriceOnlyTuner() external {
        ContentVault vault = _createVault();

        VM.expectRevert(ContentVault.ContentVault__Unauthorized.selector);
        vault.tunePrice(60_000, keccak256("bad"));

        VM.prank(TUNER);
        vault.tunePrice(60_000, keccak256("good"));
        assert(vault.priceAtomic() == 60_000);
    }

    function testTunePriceRevertsOutOfBounds() external {
        ContentVault vault = _createVault();
        uint256 tooHigh = vault.PRICE_MAX_ATOMIC() + 1;

        VM.prank(TUNER);
        VM.expectRevert(ContentVault.ContentVault__InvalidPrice.selector);
        vault.tunePrice(0, keccak256("zero"));

        VM.prank(TUNER);
        VM.expectRevert(ContentVault.ContentVault__InvalidPrice.selector);
        vault.tunePrice(tooHigh, keccak256("too-high"));
    }

    function testTunePriceAcceptsBounds() external {
        ContentVault vault = _createVault();
        uint256 minPrice = vault.PRICE_MIN_ATOMIC();
        uint256 maxPrice = vault.PRICE_MAX_ATOMIC();

        VM.prank(TUNER);
        vault.tunePrice(minPrice, keccak256("min"));
        assert(vault.priceAtomic() == minPrice);

        VM.prank(TUNER);
        vault.tunePrice(maxPrice, keccak256("max"));
        assert(vault.priceAtomic() == maxPrice);
    }

    function testWithdrawByCreatorOnly() external {
        ContentVault vault = _createVault();
        usdc.mint(address(vault), 100_000);

        VM.prank(CREATOR);
        vault.withdraw(DESTINATION, 40_000);
        assert(usdc.balanceOf(DESTINATION) == 40_000);
        assert(vault.totalWithdrawnAtomic() == 40_000);
    }

    function testWithdrawRejectsPayoutOperator() external {
        ContentVault vault = _createVault();
        usdc.mint(address(vault), 100_000);

        VM.prank(TUNER);
        VM.expectRevert(ContentVault.ContentVault__Unauthorized.selector);
        vault.withdraw(PAYOUT, 60_000);
    }

    function testWithdrawRejectsUnauthorizedCaller() external {
        ContentVault vault = _createVault();
        usdc.mint(address(vault), 100_000);

        VM.expectRevert(ContentVault.ContentVault__Unauthorized.selector);
        vault.withdraw(DESTINATION, 1);
    }

    function testWithdrawRejectsZeroAmount() external {
        ContentVault vault = _createVault();
        usdc.mint(address(vault), 100_000);

        VM.prank(CREATOR);
        VM.expectRevert(ContentVault.ContentVault__InsufficientBalance.selector);
        vault.withdraw(DESTINATION, 0);
    }

    function testWithdrawAllByCreator() external {
        ContentVault vault = _createVault();
        usdc.mint(address(vault), 77_000);

        VM.prank(CREATOR);
        vault.withdrawAll(DESTINATION);
        assert(usdc.balanceOf(DESTINATION) == 77_000);
        assert(vault.totalWithdrawnAtomic() == 77_000);
    }

    function testWithdrawAllNoopOnZeroBalance() external {
        ContentVault vault = _createVault();

        VM.prank(CREATOR);
        vault.withdrawAll(DESTINATION);
        assert(usdc.balanceOf(DESTINATION) == 0);
        assert(vault.totalWithdrawnAtomic() == 0);
    }

    function testWithdrawSignedValidSignatureSucceeds() external {
        ContentVault vault = _createVault();
        usdc.mint(address(vault), 100_000);

        (uint8 v, bytes32 r, bytes32 s) = _signWithdraw(vault, DESTINATION, 40_000, 0);

        VM.prank(TUNER);
        vault.withdrawSigned(DESTINATION, 40_000, 0, v, r, s);
        assert(usdc.balanceOf(DESTINATION) == 40_000);
        assert(vault.withdrawNonce() == 1);
    }

    function testWithdrawSignedRejectsWrongSigner() external {
        ContentVault vault = _createVault();
        usdc.mint(address(vault), 100_000);

        uint256 attackerPk = 0xBADBEEF;
        bytes32 structHash = keccak256(
            abi.encode(
                keccak256("Withdraw(address to,uint256 amountAtomic,uint256 nonce)"),
                DESTINATION,
                uint256(40_000),
                uint256(0)
            )
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", vault.domainSeparator(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = VM.sign(attackerPk, digest);

        VM.prank(TUNER);
        VM.expectRevert(ContentVault.ContentVault__Unauthorized.selector);
        vault.withdrawSigned(DESTINATION, 40_000, 0, v, r, s);
    }

    function testWithdrawSignedRejectsReusedNonce() external {
        ContentVault vault = _createVault();
        usdc.mint(address(vault), 100_000);

        (uint8 v, bytes32 r, bytes32 s) = _signWithdraw(vault, DESTINATION, 10_000, 0);
        VM.prank(TUNER);
        vault.withdrawSigned(DESTINATION, 10_000, 0, v, r, s);

        VM.prank(TUNER);
        VM.expectRevert(ContentVault.ContentVault__InvalidNonce.selector);
        vault.withdrawSigned(DESTINATION, 10_000, 0, v, r, s);
    }

    function testWithdrawSignedRejectsNonRelayerCaller() external {
        ContentVault vault = _createVault();
        usdc.mint(address(vault), 100_000);

        (uint8 v, bytes32 r, bytes32 s) = _signWithdraw(vault, DESTINATION, 10_000, 0);

        VM.expectRevert(ContentVault.ContentVault__Unauthorized.selector);
        vault.withdrawSigned(DESTINATION, 10_000, 0, v, r, s);
    }

    function testSetActiveOnlyCreator() external {
        ContentVault vault = _createVault();

        VM.expectRevert(ContentVault.ContentVault__Unauthorized.selector);
        vault.setActive(false);

        VM.prank(CREATOR);
        vault.setActive(false);
        assert(!vault.active());
    }

    function testUpdateMetadataOnlyCreator() external {
        ContentVault vault = _createVault();
        bytes32 newHash = keccak256("new-metadata");

        VM.expectRevert(ContentVault.ContentVault__Unauthorized.selector);
        vault.updateMetadata("cresc://new", newHash);

        VM.prank(CREATOR);
        vault.updateMetadata("cresc://new", newHash);
        assert(vault.metadataHash() == newHash);
        assert(keccak256(bytes(vault.metadataURI())) == keccak256("cresc://new"));
    }

    function testSetPayoutOperatorOnlyCreator() external {
        ContentVault vault = _createVault();
        address newOperator = address(0xE0E0);

        VM.expectRevert(ContentVault.ContentVault__Unauthorized.selector);
        vault.setPayoutOperator(newOperator);

        VM.prank(CREATOR);
        vault.setPayoutOperator(newOperator);
        assert(vault.payoutOperator() == newOperator);
    }

    function testSetPriceTunerOnlyCreator() external {
        ContentVault vault = _createVault();
        address newTuner = address(0xE1E1);

        VM.expectRevert(ContentVault.ContentVault__Unauthorized.selector);
        vault.setPriceTuner(newTuner);

        VM.prank(CREATOR);
        vault.setPriceTuner(newTuner);
        assert(vault.priceTuner() == newTuner);

        VM.prank(newTuner);
        vault.tunePrice(70_000, keccak256("rotated"));
        assert(vault.priceAtomic() == 70_000);
    }

    function testConstructorRevertsOnInvalidInitialPrice() external {
        bytes32 contentId = keccak256("creator-b:post-b");

        VM.prank(OWNER);
        VM.expectRevert(ContentFactory.ContentFactory__ZeroAddress.selector);
        factory.createContent(contentId, "creator-b", address(0), 50_000, "uri", bytes32(0), TUNER);
    }

    function _createVault() private returns (ContentVault vault) {
        bytes32 contentId = keccak256("creator-a:post-a");
        VM.prank(OWNER);
        address contentContract = factory.createContent(
            contentId, "creator-a", CREATOR, 50_000, "cresc://ghost/creator-a/post-a", keccak256("metadata"), TUNER
        );
        vault = ContentVault(contentContract);
    }

    function _signWithdraw(ContentVault vault, address to, uint256 amount, uint256 nonce)
        private
        returns (uint8 v, bytes32 r, bytes32 s)
    {
        bytes32 structHash = keccak256(
            abi.encode(keccak256("Withdraw(address to,uint256 amountAtomic,uint256 nonce)"), to, amount, nonce)
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", vault.domainSeparator(), structHash));
        (v, r, s) = VM.sign(CREATOR_PK, digest);
    }
}
