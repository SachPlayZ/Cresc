// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

/**
 * @title Cresc ContentVault
 * @notice Per-content USDC revenue vault and price source of truth.
 * @custom:security-contact security@cresc.app
 */
interface IERC20 {
    function transfer(address to, uint256 value) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

contract ContentVault {
    bytes32 private immutable CONTENT_ID;
    address private immutable USDC;
    bytes32 private immutable DOMAIN_SEPARATOR;
    string public creatorId;
    address public creator;
    address public priceTuner;
    address public payoutOperator;
    string public metadataURI;
    bytes32 public metadataHash;
    uint256 public priceAtomic;
    uint256 public totalWithdrawnAtomic;
    uint256 public withdrawNonce;
    bool public active;
    bool private _locked;

    uint256 public constant PRICE_MIN_ATOMIC = 1;
    uint256 public constant PRICE_MAX_ATOMIC = 1_000_000;

    bytes32 private constant EIP712_DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 private constant WITHDRAW_TYPEHASH = keccak256("Withdraw(address to,uint256 amountAtomic,uint256 nonce)");
    // secp256k1n / 2 — reject high-s signatures (malleability, matches OZ ECDSA behavior).
    uint256 private constant MAX_S = 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0;

    event PriceTuned(uint256 oldPriceAtomic, uint256 newPriceAtomic, bytes32 indexed reasonHash);
    event Withdrawn(address indexed creator, address indexed to, uint256 amountAtomic);
    event WithdrawnSigned(address indexed to, uint256 amountAtomic, uint256 nonce);
    event MetadataUpdated(string metadataURI, bytes32 metadataHash);
    event ActiveSet(bool active);
    event PayoutOperatorSet(address indexed oldOperator, address indexed newOperator);
    event PriceTunerSet(address indexed oldPriceTuner, address indexed newPriceTuner);

    error ContentVault__ZeroAddress();
    error ContentVault__Unauthorized();
    error ContentVault__InvalidPrice();
    error ContentVault__TransferFailed();
    error ContentVault__InsufficientBalance();
    error ContentVault__InvalidNonce();
    error ContentVault__InvalidSignature();
    error ContentVault__Reentrant();

    modifier nonReentrant() {
        if (_locked) revert ContentVault__Reentrant();
        _locked = true;
        _;
        _locked = false;
    }

    constructor(
        bytes32 contentId_,
        string memory creatorId_,
        address creator_,
        address usdc_,
        uint256 initialPriceAtomic_,
        string memory metadataUri_,
        bytes32 metadataHash_,
        address priceTuner_
    ) {
        if (creator_ == address(0) || usdc_ == address(0) || priceTuner_ == address(0)) {
            revert ContentVault__ZeroAddress();
        }
        if (initialPriceAtomic_ < PRICE_MIN_ATOMIC || initialPriceAtomic_ > PRICE_MAX_ATOMIC) {
            revert ContentVault__InvalidPrice();
        }

        CONTENT_ID = contentId_;
        creatorId = creatorId_;
        creator = creator_;
        USDC = usdc_;
        priceAtomic = initialPriceAtomic_;
        metadataURI = metadataUri_;
        metadataHash = metadataHash_;
        priceTuner = priceTuner_;
        payoutOperator = priceTuner_;
        active = true;

        DOMAIN_SEPARATOR = keccak256(
            abi.encode(
                EIP712_DOMAIN_TYPEHASH,
                keccak256(bytes("ContentVault")),
                keccak256(bytes("1")),
                block.chainid,
                address(this)
            )
        );
    }

    /*//////////////////////////////////////////////////////////////
                 USER-FACING STATE-CHANGING FUNCTIONS
    //////////////////////////////////////////////////////////////*/

    function tunePrice(uint256 newPriceAtomic, bytes32 reasonHash) external {
        if (msg.sender != priceTuner) revert ContentVault__Unauthorized();
        if (newPriceAtomic < PRICE_MIN_ATOMIC || newPriceAtomic > PRICE_MAX_ATOMIC) {
            revert ContentVault__InvalidPrice();
        }

        uint256 oldPriceAtomic = priceAtomic;
        priceAtomic = newPriceAtomic;
        emit PriceTuned(oldPriceAtomic, newPriceAtomic, reasonHash);
    }

    /// @notice Direct withdrawal — creator only. Calling with the creator's own key is
    /// self-authorizing; no signature needed. Arbitrary `to` is intentional (creators may
    /// withdraw to any destination they choose).
    function withdraw(address to, uint256 amountAtomic) external nonReentrant {
        if (msg.sender != creator) revert ContentVault__Unauthorized();
        if (to == address(0)) revert ContentVault__ZeroAddress();
        if (amountAtomic == 0) revert ContentVault__InsufficientBalance();

        uint256 balance = IERC20(USDC).balanceOf(address(this));
        if (amountAtomic > balance) revert ContentVault__InsufficientBalance();

        totalWithdrawnAtomic += amountAtomic;
        _safeTransfer(to, amountAtomic);
        emit Withdrawn(msg.sender, to, amountAtomic);
    }

    function withdrawAll(address to) external nonReentrant {
        if (msg.sender != creator) revert ContentVault__Unauthorized();
        if (to == address(0)) revert ContentVault__ZeroAddress();

        uint256 balance = IERC20(USDC).balanceOf(address(this));
        if (balance == 0) return;

        totalWithdrawnAtomic += balance;
        _safeTransfer(to, balance);
        emit Withdrawn(msg.sender, to, balance);
    }

    /// @notice Relayed withdrawal — callable only by `payoutOperator`, but authorizes nothing
    /// on its own: it must carry a valid, unused EIP-712 signature from `creator` over the
    /// exact (to, amountAtomic, nonce) tuple. A compromised operator key alone cannot
    /// originate a withdrawal; a leaked signature alone cannot be replayed by anyone but the
    /// designated operator. Closes the "operator can drain to any address" gap without
    /// removing the arbitrary-destination withdrawal feature.
    function withdrawSigned(address to, uint256 amountAtomic, uint256 nonce, uint8 v, bytes32 r, bytes32 s)
        external
        nonReentrant
    {
        if (msg.sender != payoutOperator) revert ContentVault__Unauthorized();
        if (to == address(0)) revert ContentVault__ZeroAddress();
        if (amountAtomic == 0) revert ContentVault__InsufficientBalance();
        if (nonce != withdrawNonce) revert ContentVault__InvalidNonce();
        if (uint256(s) > MAX_S || (v != 27 && v != 28)) revert ContentVault__InvalidSignature();

        bytes32 structHash = keccak256(abi.encode(WITHDRAW_TYPEHASH, to, amountAtomic, nonce));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, structHash));
        address signer = ecrecover(digest, v, r, s);
        if (signer == address(0)) revert ContentVault__InvalidSignature();
        if (signer != creator) revert ContentVault__Unauthorized();

        withdrawNonce = nonce + 1;

        uint256 balance = IERC20(USDC).balanceOf(address(this));
        if (amountAtomic > balance) revert ContentVault__InsufficientBalance();

        totalWithdrawnAtomic += amountAtomic;
        _safeTransfer(to, amountAtomic);
        emit WithdrawnSigned(to, amountAtomic, nonce);
    }

    function setActive(bool active_) external {
        if (msg.sender != creator) revert ContentVault__Unauthorized();
        active = active_;
        emit ActiveSet(active_);
    }

    function updateMetadata(string calldata metadataUri_, bytes32 metadataHash_) external {
        if (msg.sender != creator) revert ContentVault__Unauthorized();
        metadataURI = metadataUri_;
        metadataHash = metadataHash_;
        emit MetadataUpdated(metadataUri_, metadataHash_);
    }

    function setPayoutOperator(address payoutOperator_) external {
        if (msg.sender != creator) revert ContentVault__Unauthorized();
        if (payoutOperator_ == address(0)) revert ContentVault__ZeroAddress();
        address old = payoutOperator;
        payoutOperator = payoutOperator_;
        emit PayoutOperatorSet(old, payoutOperator_);
    }

    /// @notice Rotate the price-tuning key. Without this, a compromised/rotated EC2 tuner
    /// key would leave every existing vault permanently stuck with the old key.
    function setPriceTuner(address priceTuner_) external {
        if (msg.sender != creator) revert ContentVault__Unauthorized();
        if (priceTuner_ == address(0)) revert ContentVault__ZeroAddress();
        address old = priceTuner;
        priceTuner = priceTuner_;
        emit PriceTunerSet(old, priceTuner_);
    }

    function _safeTransfer(address to, uint256 amount) private {
        (bool success, bytes memory data) = USDC.call(abi.encodeWithSelector(IERC20.transfer.selector, to, amount));
        bool ok = success && (data.length == 0 || abi.decode(data, (bool)));
        if (!ok) revert ContentVault__TransferFailed();
    }

    /*//////////////////////////////////////////////////////////////
                      USER-FACING READ-ONLY FUNCTIONS
    //////////////////////////////////////////////////////////////*/

    function metadata() external view returns (string memory uri, bytes32 hash) {
        uri = metadataURI;
        hash = metadataHash;
    }

    function contentId() external view returns (bytes32 id) {
        id = CONTENT_ID;
    }

    function usdc() external view returns (address token) {
        token = USDC;
    }

    function domainSeparator() external view returns (bytes32 separator) {
        separator = DOMAIN_SEPARATOR;
    }
}
