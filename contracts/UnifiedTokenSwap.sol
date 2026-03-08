// SPDX-License-Identifier: GPL-3.0
pragma solidity >=0.8.12 <0.9.0;

import {HederaResponseCodes} from "./HederaResponseCodes.sol";
import {HederaTokenServiceLite} from "./HederaTokenServiceLite.sol";
import {
    IHederaTokenServiceLite
} from "./interfaces/IHederaTokenServiceLite.sol";

import {
    ITokenGraveyard
} from "@lazysuperheroes/token-graveyard/contracts/interfaces/ITokenGraveyard.sol";

import {Address} from "@openzeppelin/contracts/utils/Address.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {
    EnumerableSet
} from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import {
    ReentrancyGuard
} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title UnifiedTokenSwap
/// @author Lazy Superheroes (lazysuperheroes.com)
/// @notice Universal NFT swap contract with HBAR-based royalty bypass and optional graveyard integration
/// @dev Supports multi-admin, multi-token configurations, treasury OR graveyard destinations
contract UnifiedTokenSwap is HederaTokenServiceLite, ReentrancyGuard {
    using EnumerableSet for EnumerableSet.AddressSet;
    using SafeCast for uint256;

    // ============================================
    // ERRORS
    // ============================================

    error BadInput();
    error ExceedsMaxSerials();
    error NotAdmin();
    error CannotRemoveLastAdmin();
    error ConfigNotFound(address token, uint256 serial);
    error ContractPaused();
    error AssociationFailed();
    error NFTTransferFailed();
    error GraveyardStakeFailed();
    error NFTApprovalFailed(address token, uint256 serial, address spender);

    // ============================================
    // CONSTANTS
    // ============================================

    /// @notice Maximum NFTs per transaction batch when using HBAR royalty defeat
    /// @dev Hedera allows 10 transfer legs max. HBAR legs (-1/+1 tinybar) consume 2, leaving 8 for NFTs
    uint256 private constant MAX_NFTS_PER_TX = 8;

    // ============================================
    // STRUCTS
    // ============================================

    /// @notice Configuration for a single swap mapping
    /// @param outputToken The new NFT token address to give user
    /// @param treasury Where old NFT goes (if not using graveyard)
    /// @param useGraveyard If true, sends old NFT to graveyard instead of treasury
    /// @param outputSerial The serial number of the new NFT to give
    struct SwapConfig {
        address outputToken;
        address treasury;
        bool useGraveyard;
        uint256 outputSerial;
    }

    // ============================================
    // STATE
    // ============================================

    /// @notice Set of admin addresses (multi-admin support)
    EnumerableSet.AddressSet private admins;

    /// @notice Set of output token addresses (for association tracking)
    EnumerableSet.AddressSet private outputTokens;

    /// @notice Set of input token addresses (for graveyard flow association tracking)
    EnumerableSet.AddressSet private inputTokens;

    /// @notice Mapping from input hash to swap configuration
    /// @dev Key is keccak256(abi.encodePacked(inputToken, inputSerial))
    mapping(bytes32 => SwapConfig) public swapConfigs;

    /// @notice Token Graveyard contract for permanent NFT disposal
    ITokenGraveyard public graveyard;

    /// @notice Whether the contract is paused
    bool public paused;

    /// @notice Tracks which tokens have been approved for graveyard (to avoid 100 allowance limit)
    mapping(address => bool) private graveyardApprovals;

    /// @notice Counter for number of unique tokens approved for graveyard
    uint256 private graveyardApprovalCount;

    // ============================================
    // EVENTS
    // ============================================

    /// @notice Emitted on NFT swaps and admin actions
    /// @param user Address performing the action
    /// @param inputToken Old NFT token address (0x0 for admin actions)
    /// @param inputSerial Serial of old NFT (0 for admin actions)
    /// @param outputToken New NFT token address (0x0 for admin actions)
    /// @param outputSerial Serial of new NFT (0 for admin actions)
    /// @param message Description of the action
    event SwapEvent(
        address indexed user,
        address indexed inputToken,
        uint256 inputSerial,
        address indexed outputToken,
        uint256 outputSerial,
        string message
    );

    /// @notice Emitted when admin is added or removed
    /// @param admin The admin address affected
    /// @param added True if added, false if removed
    event AdminChanged(address indexed admin, bool indexed added);

    // ============================================
    // MODIFIERS
    // ============================================

    /// @notice Restricts function to admin addresses only
    modifier onlyAdmin() {
        if (!admins.contains(msg.sender)) revert NotAdmin();
        _;
    }

    // ============================================
    // CONSTRUCTOR
    // ============================================

    /// @notice Initializes the UnifiedTokenSwap contract
    /// @param _graveyard Token Graveyard contract address (can be address(0) if not using graveyard)
    constructor(address _graveyard) {
        // Deployer is first admin
        admins.add(msg.sender);
        emit AdminChanged(msg.sender, true);

        // Set graveyard if provided
        if (_graveyard != address(0)) {
            graveyard = ITokenGraveyard(_graveyard);
        }

        paused = true;
    }

    // ============================================
    // INTERNAL HELPERS
    // ============================================

    /// @notice Builds a tinybar transfer structure for royalty defeat
    /// @param sender Address sending 1 tinybar
    /// @param receiver Address receiving 1 tinybar
    /// @param senderUsesAllowance True if sender is paying via allowance
    /// @return transferList The constructed HBAR transfer structure
    function _buildTinybarTransfer(
        address sender,
        address receiver,
        bool senderUsesAllowance
    ) internal pure returns (IHederaTokenServiceLite.TransferList memory transferList) {
        transferList.transfers = new IHederaTokenServiceLite.AccountAmount[](2);

        transferList.transfers[0].accountID = sender;
        transferList.transfers[0].amount = -1;
        transferList.transfers[0].isApproval = senderUsesAllowance;

        transferList.transfers[1].accountID = receiver;
        transferList.transfers[1].amount = 1;
        transferList.transfers[1].isApproval = false;
    }

    /// @notice Builds a single NFT transfer structure
    /// @param token NFT token address
    /// @param serial Serial number to transfer
    /// @param sender Address sending the NFT
    /// @param receiver Address receiving the NFT
    /// @param isApproval True if transfer uses allowance
    /// @return tokenTransfers Array with single NFT transfer
    function _buildNftTransferList(
        address token,
        uint256 serial,
        address sender,
        address receiver,
        bool isApproval
    ) internal pure returns (IHederaTokenServiceLite.TokenTransferList[] memory tokenTransfers) {
        tokenTransfers = new IHederaTokenServiceLite.TokenTransferList[](1);

        tokenTransfers[0].token = token;
        tokenTransfers[0].nftTransfers = new IHederaTokenServiceLite.NftTransfer[](1);
        tokenTransfers[0].nftTransfers[0].senderAccountID = sender;
        tokenTransfers[0].nftTransfers[0].receiverAccountID = receiver;
        tokenTransfers[0].nftTransfers[0].serialNumber = int64(serial.toUint64());
        tokenTransfers[0].nftTransfers[0].isApproval = isApproval;
    }

    /// @notice Pulls old NFT from user to contract with tinybar royalty defeat
    function _pullNftFromUser(address token, uint256 serial) internal {
        int32 responseCode = cryptoTransfer(
            _buildTinybarTransfer(address(this), msg.sender, false),
            _buildNftTransferList(token, serial, msg.sender, address(this), true)
        );
        if (responseCode != HederaResponseCodes.SUCCESS) {
            revert NFTTransferFailed();
        }
    }

    /// @notice Sends new NFT from contract to user with tinybar royalty defeat
    function _sendNftToUser(address token, uint256 serial) internal {
        int32 responseCode = cryptoTransfer(
            _buildTinybarTransfer(msg.sender, address(this), true),
            _buildNftTransferList(token, serial, address(this), msg.sender, false)
        );
        if (responseCode != HederaResponseCodes.SUCCESS) {
            revert NFTTransferFailed();
        }
    }

    /// @notice Associates a token with this contract, reverting if association fails
    function _associateIfNeeded(address _token) internal {
        int32 responseCode = associateToken(address(this), _token);
        if (
            !(responseCode == HederaResponseCodes.SUCCESS ||
                responseCode == HederaResponseCodes.TOKEN_ALREADY_ASSOCIATED_TO_ACCOUNT)
        ) {
            revert AssociationFailed();
        }
    }

    // ============================================
    // ADMIN MANAGEMENT
    // ============================================

    /// @notice Adds a new admin
    /// @param _admin Address to add as admin
    function addAdmin(address _admin) external onlyAdmin {
        if (_admin == address(0)) revert BadInput();
        if (admins.add(_admin)) {
            emit AdminChanged(_admin, true);
        }
    }

    /// @notice Removes an admin (cannot remove last admin)
    /// @param _admin Address to remove from admins
    function removeAdmin(address _admin) external onlyAdmin {
        if (admins.length() <= 1) revert CannotRemoveLastAdmin();
        if (admins.remove(_admin)) {
            emit AdminChanged(_admin, false);
        }
    }

    /// @notice Returns all admin addresses
    /// @return Array of admin addresses
    function getAdmins() external view returns (address[] memory) {
        return admins.values();
    }

    /// @notice Checks if an address is an admin
    /// @param _account Address to check
    /// @return True if address is an admin
    function isAdmin(address _account) external view returns (bool) {
        return admins.contains(_account);
    }

    // ============================================
    // CONFIGURATION
    // ============================================

    /// @notice Updates the contract's paused state
    /// @param _paused True to pause, false to unpause
    /// @return changed True if state was changed
    function updatePauseStatus(
        bool _paused
    ) external onlyAdmin returns (bool changed) {
        changed = _paused != paused;
        paused = _paused;
        if (changed) {
            emit SwapEvent(
                msg.sender,
                address(0),
                0,
                address(0),
                0,
                _paused ? "PAUSED" : "UNPAUSED"
            );
        }
    }

    /// @notice Updates the graveyard contract reference
    /// @param _graveyard New graveyard contract address
    function updateGraveyard(address _graveyard) external onlyAdmin {
        if (_graveyard == address(0)) revert BadInput();
        graveyard = ITokenGraveyard(_graveyard);
    }

    /// @notice Associates an output token with this contract
    /// @dev Checks both input and output sets before attempting association (O(1) lookups)
    /// @param _token Token address to associate
    function addOutputToken(address _token) external onlyAdmin {
        if (_token == address(0)) revert BadInput();

        // Skip association if already tracked in either set
        if (!inputTokens.contains(_token) && !outputTokens.contains(_token)) {
            _associateIfNeeded(_token);
        }

        // Always add to output tokens set (even if already in input set)
        outputTokens.add(_token);
    }

    /// @notice Returns all configured output tokens
    /// @return Array of output token addresses
    function getOutputTokens() external view returns (address[] memory) {
        return outputTokens.values();
    }

    /// @notice Returns all configured input tokens (graveyard flow)
    /// @return Array of input token addresses
    function getInputTokens() external view returns (address[] memory) {
        return inputTokens.values();
    }

    /// @notice Checks if a token is associated with this contract (tracked in input or output sets)
    /// @param _token Token address to check
    /// @return True if token is in either the input or output token set
    function isTokenAssociated(address _token) external view returns (bool) {
        return inputTokens.contains(_token) || outputTokens.contains(_token);
    }

    /// @notice Returns the number of unique tokens approved for the graveyard
    /// @dev Helps monitor if approaching any smart contract allowance limits
    /// @return The count of tokens that have been approved via setApprovalForAll for graveyard
    function getGraveyardApprovalCount() external view returns (uint256) {
        return graveyardApprovalCount;
    }

    // ============================================
    // SWAP CONFIGURATION
    // ============================================

    /// @notice Adds or updates swap configurations
    /// @dev Auto-associates input tokens if not already tracked (both treasury and graveyard flows
    ///      pull NFT to contract first). Add ~950,000 gas per new input token being associated.
    /// @param _inputTokens Array of input NFT token addresses
    /// @param _inputSerials Array of input NFT serial numbers
    /// @param _configs Array of SwapConfig structs defining the swap
    function addSwapConfigs(
        address[] calldata _inputTokens,
        uint256[] calldata _inputSerials,
        SwapConfig[] calldata _configs
    ) external onlyAdmin {
        if (
            _inputTokens.length != _inputSerials.length ||
            _inputSerials.length != _configs.length
        ) {
            revert BadInput();
        }

        uint256 length = _inputTokens.length;
        for (uint256 i = 0; i < length; ) {
            // Auto-associate input token if not already tracked
            // Both treasury and graveyard flows pull NFT to contract first
            _ensureInputTokenAssociated(_inputTokens[i]);

            if (_configs[i].outputToken == address(0)) revert BadInput();

            bytes32 hash = keccak256(
                abi.encodePacked(_inputTokens[i], _inputSerials[i])
            );
            swapConfigs[hash] = _configs[i];
            unchecked {
                ++i;
            }
        }
    }

    /// @notice Ensures an input token is associated with this contract
    /// @dev Checks both input and output sets before attempting association (O(1) lookups)
    /// @param _token Token address to associate
    function _ensureInputTokenAssociated(address _token) internal {
        // Skip if already tracked in either set (O(1) check)
        if (inputTokens.contains(_token) || outputTokens.contains(_token)) {
            return;
        }

        // Associate the token
        _associateIfNeeded(_token);

        // Track in input tokens set
        inputTokens.add(_token);
    }

    /// @notice Removes swap configurations
    /// @param _inputTokens Array of input NFT token addresses
    /// @param _inputSerials Array of input NFT serial numbers
    function removeSwapConfigs(
        address[] calldata _inputTokens,
        uint256[] calldata _inputSerials
    ) external onlyAdmin {
        if (_inputTokens.length != _inputSerials.length) revert BadInput();

        uint256 length = _inputTokens.length;
        for (uint256 i = 0; i < length; ) {
            bytes32 hash = keccak256(
                abi.encodePacked(_inputTokens[i], _inputSerials[i])
            );
            delete swapConfigs[hash];
            unchecked {
                ++i;
            }
        }
    }

    /// @notice Retrieves swap configurations for given inputs
    /// @param _inputTokens Array of input token addresses
    /// @param _inputSerials Array of input serial numbers
    /// @return configs Array of SwapConfig structs
    function getSwapConfigs(
        address[] calldata _inputTokens,
        uint256[] calldata _inputSerials
    ) external view returns (SwapConfig[] memory configs) {
        if (_inputTokens.length != _inputSerials.length) revert BadInput();

        configs = new SwapConfig[](_inputTokens.length);
        uint256 length = _inputTokens.length;
        for (uint256 i = 0; i < length; ) {
            bytes32 hash = keccak256(
                abi.encodePacked(_inputTokens[i], _inputSerials[i])
            );
            configs[i] = swapConfigs[hash];
            unchecked {
                ++i;
            }
        }
    }

    // ============================================
    // SWAP FUNCTIONS
    // ============================================

    /// @notice Swaps old NFTs for new NFTs based on configuration
    /// @dev Uses tinybar payment to defeat royalties. Supports treasury or graveyard destination.
    /// @param _inputTokens Array of input NFT token addresses
    /// @param _inputSerials Array of input NFT serial numbers
    function swapNFTs(
        address[] calldata _inputTokens,
        uint256[] calldata _inputSerials
    ) external nonReentrant {
        if (_inputSerials.length > type(uint8).max) revert ExceedsMaxSerials();
        if (_inputTokens.length != _inputSerials.length) revert BadInput();
        if (paused) revert ContractPaused();

        uint256 length = _inputSerials.length;

        // Process swaps - separate treasury and graveyard flows
        for (uint256 i = 0; i < length; ) {
            bytes32 hash = keccak256(
                abi.encodePacked(_inputTokens[i], _inputSerials[i])
            );
            SwapConfig memory config = swapConfigs[hash];

            if (config.outputToken == address(0)) {
                revert ConfigNotFound(_inputTokens[i], _inputSerials[i]);
            }

            // Remove config (one-time swap)
            delete swapConfigs[hash];

            if (config.useGraveyard) {
                // Graveyard flow
                _processGraveyardSwap(
                    _inputTokens[i],
                    _inputSerials[i],
                    config
                );
            } else {
                // Treasury flow with tinybar royalty defeat
                _processTreasurySwap(_inputTokens[i], _inputSerials[i], config);
            }

            emit SwapEvent(
                msg.sender,
                _inputTokens[i],
                _inputSerials[i],
                config.outputToken,
                config.outputSerial,
                config.useGraveyard
                    ? "Swapped (Graveyard)"
                    : "Swapped (Treasury)"
            );

            unchecked {
                ++i;
            }
        }
    }

    /// @notice Processes a swap with treasury destination using tinybar to defeat royalties
    /// @dev Three-legged transfer: (1) pull old NFT, (2) send to treasury, (3) send new NFT
    ///      User receives 1 tinybar in step 1, pays 1 tinybar in step 3 (net 0)
    ///      User must have HBAR allowance to contract for step 3
    function _processTreasurySwap(
        address inputToken,
        uint256 inputSerial,
        SwapConfig memory config
    ) internal {
        // Step 1: Pull old NFT from user to contract
        // Contract pays user 1 tinybar to defeat royalty on incoming NFT
        _pullNftFromUser(inputToken, inputSerial);

        // Step 2: Send old NFT from contract to treasury
        // Contract pays treasury 1 tinybar to defeat royalty
        int32 responseCode = cryptoTransfer(
            _buildTinybarTransfer(address(this), config.treasury, false),
            _buildNftTransferList(inputToken, inputSerial, address(this), config.treasury, false)
        );
        if (responseCode != HederaResponseCodes.SUCCESS) {
            revert NFTTransferFailed();
        }

        // Step 3: Send new NFT to user
        // User pays contract 1 tinybar (via allowance) to defeat royalty on output NFT
        _sendNftToUser(config.outputToken, config.outputSerial);
    }

    /// @notice Processes a swap with graveyard destination
    /// @dev Two-step: pull NFT to contract, then stake to graveyard via interface
    ///      Uses setApprovalForAll to avoid Hedera's 100 allowance limit
    function _processGraveyardSwap(
        address inputToken,
        uint256 inputSerial,
        SwapConfig memory config
    ) internal {
        // Step 1: Pull old NFT from user to contract (via allowance)
        // Contract pays user 1 tinybar to defeat royalty on incoming NFT
        _pullNftFromUser(inputToken, inputSerial);

        // Prepare serials array for graveyard stake
        uint256[] memory serials = new uint256[](1);
        serials[0] = inputSerial;

        // Set approval for all serials if not already done (once per token)
        // This avoids Hedera's 100 allowance limit when swapping many NFTs
        if (!graveyardApprovals[inputToken]) {
            int256 approvalResponse = setApprovalForAll(
                inputToken,
                address(graveyard),
                true
            );

            if (approvalResponse != HederaResponseCodes.SUCCESS) {
                revert NFTApprovalFailed(
                    inputToken,
                    0, // Use 0 for serial since this is an all-serials approval
                    address(graveyard)
                );
            }

            graveyardApprovals[inputToken] = true;
            graveyardApprovalCount++;
        }

        // Step 2: Stake to graveyard contract
        // solhint-disable-next-line no-empty-blocks
        try graveyard.stakeNFTsToTheGrave(inputToken, serials) {} catch {
            revert GraveyardStakeFailed();
        }

        // Step 3: Send new NFT to user
        // User pays contract 1 tinybar (via allowance) to defeat royalty on output NFT
        _sendNftToUser(config.outputToken, config.outputSerial);
    }

    // ============================================
    // STAKING (LOAD NEW NFTs INTO CONTRACT)
    // ============================================

    /// @notice Stakes new NFTs into the contract for distribution
    /// @dev Uses tinybar payment to defeat royalties when loading NFTs with fallback fees
    /// @param token The NFT token address to stake
    /// @param serials Array of serial numbers to stake into the contract
    function stakeNFTs(address token, uint256[] calldata serials) external nonReentrant {
        if (serials.length == 0 || serials.length > MAX_NFTS_PER_TX)
            revert BadInput();

        // Build transfer: tinybar from contract to sender + NFTs from sender to contract
        IHederaTokenServiceLite.TransferList memory hbarTransfers = _buildTinybarTransfer(address(this), msg.sender, false);

        // NFT transfers: all serials from sender to contract
        IHederaTokenServiceLite.TokenTransferList[]
            memory tokenTransfers = new IHederaTokenServiceLite.TokenTransferList[](
                serials.length
            );

        for (uint256 i = 0; i < serials.length; ) {
            tokenTransfers[i].token = token;
            tokenTransfers[i]
                .nftTransfers = new IHederaTokenServiceLite.NftTransfer[](1);
            tokenTransfers[i].nftTransfers[0].senderAccountID = msg.sender;
            tokenTransfers[i].nftTransfers[0].receiverAccountID = address(this);
            tokenTransfers[i].nftTransfers[0].serialNumber = int64(
                serials[i].toUint64()
            );
            tokenTransfers[i].nftTransfers[0].isApproval = true;

            unchecked {
                ++i;
            }
        }

        // Execute atomic transfer
        int32 responseCode = cryptoTransfer(hbarTransfers, tokenTransfers);
        if (responseCode != HederaResponseCodes.SUCCESS) {
            revert NFTTransferFailed();
        }

        emit SwapEvent(
            msg.sender,
            token,
            serials.length,
            address(this),
            0,
            "NFTs Staked"
        );
    }

    /// @notice Unstakes NFTs from the contract (admin recovery function)
    /// @dev Allows admin to recover stuck NFTs. Receiver must have HBAR allowance
    ///      to contract (1 tinybar per call) for royalty defeat.
    /// @param token The NFT token address to unstake
    /// @param serials Array of serial numbers to unstake from the contract
    /// @param receiver Address to receive the unstaked NFTs (must have HBAR allowance to contract)
    function unstakeNFTs(
        address token,
        uint256[] calldata serials,
        address receiver
    ) external onlyAdmin nonReentrant {
        if (
            serials.length == 0 ||
            serials.length > MAX_NFTS_PER_TX ||
            receiver == address(0)
        ) revert BadInput();

        // Build transfer: tinybar from receiver to contract + NFTs from contract to receiver
        // Receiver pays 1 tinybar (via allowance) to defeat royalty on outgoing NFTs
        IHederaTokenServiceLite.TransferList memory hbarTransfers = _buildTinybarTransfer(receiver, address(this), true);

        // NFT transfers: all serials from contract to receiver
        IHederaTokenServiceLite.TokenTransferList[]
            memory tokenTransfers = new IHederaTokenServiceLite.TokenTransferList[](
                serials.length
            );

        for (uint256 i = 0; i < serials.length; ) {
            tokenTransfers[i].token = token;
            tokenTransfers[i]
                .nftTransfers = new IHederaTokenServiceLite.NftTransfer[](1);
            tokenTransfers[i].nftTransfers[0].senderAccountID = address(this);
            tokenTransfers[i].nftTransfers[0].receiverAccountID = receiver;
            tokenTransfers[i].nftTransfers[0].serialNumber = int64(
                serials[i].toUint64()
            );
            tokenTransfers[i].nftTransfers[0].isApproval = false;

            unchecked {
                ++i;
            }
        }

        // Execute atomic transfer
        int32 responseCode = cryptoTransfer(hbarTransfers, tokenTransfers);
        if (responseCode != HederaResponseCodes.SUCCESS) {
            revert NFTTransferFailed();
        }

        emit SwapEvent(
            receiver,
            token,
            serials.length,
            address(this),
            0,
            "NFTs Unstaked"
        );
    }

    // ============================================
    // ADMIN UTILITIES
    // ============================================

    /// @notice Transfers HBAR out of the contract
    /// @param receiverAddress Address to receive HBAR
    /// @param amount Amount in tinybars
    function transferHbar(
        address payable receiverAddress,
        uint256 amount
    ) external onlyAdmin {
        if (receiverAddress == address(0) || amount == 0) revert BadInput();
        Address.sendValue(receiverAddress, amount);

        emit SwapEvent(
            receiverAddress,
            address(0),
            amount,
            address(0),
            0,
            "Hbar Transfer"
        );
    }

    /// @notice Handles direct HBAR transfers to contract
    receive() external payable {
        emit SwapEvent(
            msg.sender,
            address(0),
            msg.value,
            address(0),
            0,
            "Hbar Received"
        );
    }

    /// @notice Fallback for calls with data
    fallback() external payable {
        emit SwapEvent(
            msg.sender,
            address(0),
            msg.value,
            address(0),
            0,
            "Fallback Called"
        );
    }
}
