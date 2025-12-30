// SPDX-License-Identifier: GPL-3.0
pragma solidity >=0.8.12 <0.9.0;

/*
 * ⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡
 * ⚡                                                             ⚡
 * ⚡                        LAZY SUPERHEROES                     ⚡
 * ⚡                      The OG Hedera Project                  ⚡
 * ⚡                                                             ⚡
 * ⚡                        %%%%#####%%@@@@                      ⚡
 * ⚡                   @%%%@%###%%%%###%%%%%@@                   ⚡
 * ⚡                %%%%%%@@@@@@@@@@@@@@@@%##%%@@                ⚡
 * ⚡              @%%@#@@@@@@@@@@@@@@@@@@@@@@@@*%%@@             ⚡
 * ⚡            @%%%%@@@@@@@@@@@@@@@@@@@@@@@@@@@@%*%@@           ⚡
 * ⚡           %%%#@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@%#%@@         ⚡
 * ⚡          %%%@@@@@@@@@@@@@@#-:--==+#@@@@@@@@@@@@@*%@@        ⚡
 * ⚡         %@#@@@@@@@@@@@@@@*-------::%@@@@@@@@%%%%%*%@@       ⚡
 * ⚡        %%#@@@@@@@@@@@@@@@=-------:#@@@@@@@@@%%%%%%*%@@      ⚡
 * ⚡       %%#@@@@@@@@@@@@@@@#-------:+@@@@@@@@@@%%%%%%%#%@@     ⚡
 * ⚡       %%#@@@@@@@@@@@@@@@=------:=@@@@@@@@@@@%%%%%%%%#@@     ⚡
 * ⚡      #%#@@@%%%%%%%@@@@@%------:-@@@@@@@@@@@@@%%%%%%%#%@@    ⚡
 * ⚡      %%#@@@%%%%%%%%@@@@=------------:::@@@@@@@@%%%%%#%@@    ⚡
 * ⚡      %%#@@%%%%%%%%%@@@%:------------::%@@@@@@@@@%%%%#%@@    ⚡
 * ⚡      %%#@@%%%%%%%%%@@@=:::---------:-@@@@@@@@@@@@@@@#@@@    ⚡
 * ⚡      #%#@@@%%%%%%%@@@@*:::::::----:-@@@@@@@@@@@@@@@@#@@@    ⚡
 * ⚡      %%%%@@@@%%%%%@@@@@@@@@@-:---:=@@@@@@@@@@@@@@@@@%@@@    ⚡
 * ⚡       %%#@@@@%%%%@@@@@@@@@@@::--:*@@@@@@@@@@@@@@@@@%@@@     ⚡
 * ⚡       %#%#@@@%@%%%@@@@@@@@@#::::#@@@@@@@@@@@@@@@@@@%@@@     ⚡
 * ⚡        %%%%@@@%%%%%%@@@@@@@*:::%@@@@@@@@@@@@@@@@@@%@@@      ⚡
 * ⚡         %%#%@@%%%%%%%@@@@@@=.-%@@@@@@@@@@@@@@@@@@%@@@       ⚡
 * ⚡          %##*@%%%%%%%%%@@@@=+@@@@@@@@@@@@@@@@@@%%@@@        ⚡
 * ⚡           %##*%%%%%%%%%%@@@@@@@@@@@@@@@@@@@@@@%@@@@         ⚡
 * ⚡             %##+#%%%%%%%%@@@@@@@@@@@@@@@@@@@%@@@@           ⚡
 * ⚡               %##*=%%%%%%%@@@@@@@@@@@@@@@#@@@@@             ⚡
 * ⚡                 %##%#**#@@@@@@@@@@@@%%%@@@@@@               ⚡
 * ⚡                    %%%%@@%@@@%%@@@@@@@@@@@                  ⚡
 * ⚡                         %%%%%%%%%%%@@                       ⚡
 * ⚡                                                             ⚡
 * ⚡                 Development Team Focused on                 ⚡
 * ⚡                   Decentralized Solutions                   ⚡
 * ⚡                                                             ⚡
 * ⚡         Visit: http://lazysuperheroes.com/                  ⚡
 * ⚡            or: https://dapp.lazysuperheroes.com/            ⚡
 * ⚡                   to get your LAZY on!                      ⚡
 * ⚡                                                             ⚡
 * ⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡
 */

import {HederaResponseCodes} from "./HederaResponseCodes.sol";
import {HederaTokenService} from "./HederaTokenService.sol";
import {IHederaTokenService} from "./interfaces/IHederaTokenService.sol";

import {ILazyGasStation} from "./interfaces/ILazyGasStation.sol";

// Import OpenZeppelin Contracts where needed
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {
    EnumerableMap
} from "@openzeppelin/contracts/utils/structs/EnumerableMap.sol";

/// @title FallbackTokenSwap
/// @author Lazy Superheroes (lazysuperheroes.com)
/// @notice NFT swap contract with LazyGasStation integration for automatic gas refills
/// @dev Enables swapping legacy NFTs for new collection NFTs with LAZY token rewards
contract FallbackTokenSwap is HederaTokenService, Ownable {
    using EnumerableMap for EnumerableMap.Bytes32ToUintMap;
    using SafeCast for uint256;

    error BadInput();
    error ExceedsMaxSerials();
    error AssociationFailed();
    error ConfigNotFound(address token, uint256 serial);
    error ContractPaused();
    error NFTEOA2SCTransferFailed();
    error NFTSC2TreasuryTransferFailed();
    error NFTSC2EOATransferFailed();
    error FTTransferFailed();
    error StakingFailed();

    uint256 private constant MAX_NFTS_PER_TX = 8;

    /// @notice Address of the NFT collection being swapped (new tokens to distribute)
    address public swapToken;
    /// @notice Treasury address where old NFTs are sent after swap
    address public swapTokenTreasury;
    /// @notice Address of the LAZY token used for rewards
    address public lazyToken;
    /// @notice LazyGasStation contract for automatic LAZY refills
    ILazyGasStation public lazyGasStation;

    /// @notice Amount of LAZY tokens paid per NFT swap
    uint256 public lazyPmtAmt;

    EnumerableMap.Bytes32ToUintMap private hashToSerialMap;

    /// @notice Whether the contract is paused (true = paused)
    bool public paused;

    /// @notice Emitted on NFT swaps and status changes
    /// @param user Address of the user performing the action
    /// @param oldToken Address of the old NFT token (0x0 for status changes)
    /// @param oldSerial Serial number of the old NFT (0 for status changes)
    /// @param newToken Address of the new NFT token (0x0 for status changes)
    /// @param newSerial Serial number of the new NFT (0 for status changes)
    /// @param message Description of the action (e.g., "SWAP", "PAUSED", "UNPAUSED")
    event TokenSwapEvent(
        address indexed user,
        address indexed oldToken,
        uint256 oldSerial,
        address indexed newToken,
        uint256 newSerial,
        string message
    );

    /// @notice Initializes the FallbackTokenSwap contract
    /// @param _swapToken Address of the new NFT collection to distribute
    /// @param _swapTokenTreasury Treasury address to receive old NFTs
    /// @param _lgs LazyGasStation contract address for gas management
    /// @param _lazy LAZY token address for rewards
    constructor(
        address _swapToken,
        address _swapTokenTreasury,
        address _lgs,
        address _lazy
    ) {
        swapToken = _swapToken;
        swapTokenTreasury = _swapTokenTreasury;
        lazyToken = _lazy;
        lazyGasStation = ILazyGasStation(_lgs);

        paused = true;

        // create an address array of lazy token and swap token
        address[] memory _tokens = new address[](2);
        _tokens[0] = lazyToken;
        _tokens[1] = swapToken;

        int256 responseCode = associateTokens(address(this), _tokens);

        if (responseCode != HederaResponseCodes.SUCCESS) {
            revert AssociationFailed();
        }
    }

    /// @notice Updates the contract's paused state
    /// @param _paused boolean to pause (true) or release (false)
    /// @return changed indicative of whether a change was made
    function updatePauseStatus(
        bool _paused
    ) external onlyOwner returns (bool changed) {
        changed = _paused == paused ? false : true;
        paused = _paused;
        if (changed) {
            emit TokenSwapEvent(
                msg.sender,
                address(0),
                0,
                address(0),
                0,
                _paused ? "PAUSED" : "UNPAUSED"
            );
        }
    }

    /// @notice Updates the LazyGasStation contract reference
    /// @param _lgs New LazyGasStation contract address
    function updateLGS(address _lgs) external onlyOwner {
        if (_lgs == address(0)) revert BadInput();
        lazyGasStation = ILazyGasStation(_lgs);
    }

    /// @notice Updates the LAZY token address
    /// @param _lazy New LAZY token address
    function updateLazyToken(address _lazy) external onlyOwner {
        if (_lazy == address(0)) revert BadInput();
        lazyToken = _lazy;
    }

    /// @notice Updates the swap token (new NFT collection) and associates it
    /// @param _swapToken New swap token address
    function updateSwapToken(address _swapToken) external onlyOwner {
        if (_swapToken == address(0)) revert BadInput();
        swapToken = _swapToken;

        // associate the new token with this contract
        int256 responseCode = associateToken(address(this), swapToken);
        if (
            !(responseCode == HederaResponseCodes.SUCCESS ||
                responseCode ==
                HederaResponseCodes.TOKEN_ALREADY_ASSOCIATED_TO_ACCOUNT)
        ) {
            revert AssociationFailed();
        }
    }

    /// @notice Updates the LAZY token reward amount per swap
    /// @param _amount New reward amount in LAZY tokens (with decimals)
    function updateClaimAmount(uint256 _amount) external onlyOwner {
        lazyPmtAmt = _amount;
    }

    /// @notice Adds or updates swap configuration mappings
    /// @param newSerials Array of new NFT serial numbers to distribute
    /// @param swapHashes Array of keccak256 hashes of (oldToken, oldSerial) pairs
    function updateSwapConfig(
        uint256[] calldata newSerials,
        bytes32[] calldata swapHashes
    ) external onlyOwner {
        if (newSerials.length != swapHashes.length) revert BadInput();

        uint256 length = newSerials.length;
        for (uint256 i = 0; i < length; ) {
            hashToSerialMap.set(swapHashes[i], newSerials[i]);
            unchecked {
                ++i;
            }
        }
    }

    /// @notice Associates tokens to this contract for staked swap operations
    /// @param _tokens Array of token addresses to associate
    function prepareForStakedSwap(
        address[] calldata _tokens
    ) external onlyOwner {
        int256 responseCode = associateTokens(address(this), _tokens);

        if (responseCode != HederaResponseCodes.SUCCESS) {
            revert AssociationFailed();
        }
    }

    /// @notice Removes swap configuration entries
    /// @param _swapHashes Array of swap hashes to remove from configuration
    function removeSwapConfig(
        bytes32[] calldata _swapHashes
    ) external onlyOwner {
        uint256 length = _swapHashes.length;
        for (uint256 i = 0; i < length; ) {
            hashToSerialMap.remove(_swapHashes[i]);
            unchecked {
                ++i;
            }
        }
    }

    /// @notice Retrieves new serial numbers for given swap hashes
    /// @param swapHashes Array of swap hashes to look up
    /// @return serials Array of corresponding new serial numbers (0 if not found)
    function getSerials(
        bytes32[] calldata swapHashes
    ) external view returns (uint256[] memory serials) {
        serials = new uint256[](swapHashes.length);
        uint256 length = swapHashes.length;
        for (uint256 i = 0; i < length; ) {
            (, serials[i]) = hashToSerialMap.tryGet(swapHashes[i]);
            unchecked {
                ++i;
            }
        }
    }

    /// @notice Swaps old NFTs for new NFTs and pays LAZY rewards
    /// @dev Performs 3 transfers per NFT: EOA→SC, SC→Treasury, SC→EOA (new NFT)
    /// @param tokensToSwap Array of old NFT token addresses to swap
    /// @param serials Array of serial numbers of the NFTs to transfer
    /// @return amt Total LAZY tokens paid as rewards
    function swapNFTs(
        address[] calldata tokensToSwap,
        uint256[] calldata serials
    ) external returns (uint256 amt) {
        if (serials.length > type(uint8).max) revert ExceedsMaxSerials();
        if (tokensToSwap.length != serials.length) revert BadInput();
        if (paused) revert ContractPaused();
        int256 responseCode;

        // check if we need to refill the lazy token
        if (IERC20(lazyToken).balanceOf(address(this)) < 20) {
            lazyGasStation.refillLazy(50);
        }

        /* 
			We will be doing 3 transfers per NFT
			1. Old From EOA to SC
			2. Old From SC to Treasury
			3. New From SC to EOA
		*/
        for (uint256 outer = 0; outer < serials.length; outer += 8) {
            // outer loop to group transfers efficiently in bundles of 8
            // add 1 extra transfer slot for the $LAZY transfer (made of two legs)
            uint256 arraySze = Math.min(serials.length - outer, 8) + 1;
            IHederaTokenService.TokenTransferList[]
                memory _transfersFromEOA = new IHederaTokenService.TokenTransferList[](
                    arraySze
                );
            IHederaTokenService.TokenTransferList[]
                memory _transfersSCToTsry = new IHederaTokenService.TokenTransferList[](
                    arraySze
                );
            IHederaTokenService.TokenTransferList[]
                memory _transfersToEOA = new IHederaTokenService.TokenTransferList[](
                    arraySze
                );
            // inner loop to group transfers efficiently in bundles of 8
            for (
                uint8 inner = 0;
                (inner < 8) && (outer + inner < serials.length);
                ++inner
            ) {
                // check the NFT is burn eligible
                address tokenToSwap = tokensToSwap[outer + inner];
                uint256 serialToSwap = serials[outer + inner];
                bytes32 swapHash = keccak256(
                    abi.encodePacked(tokenToSwap, serialToSwap)
                );
                (bool found, uint256 newSerial) = hashToSerialMap.tryGet(
                    swapHash
                );
                if (found) {
                    // calculate amount to send
                    amt += lazyPmtAmt;

                    // update the record
                    hashToSerialMap.remove(swapHash);

                    // transfer From EOA to SC
                    _transfersFromEOA[inner].token = tokenToSwap;
                    _transfersFromEOA[inner]
                        .nftTransfers = new IHederaTokenService.NftTransfer[](
                        1
                    );

                    IHederaTokenService.NftTransfer memory _nftTransferOld;
                    _nftTransferOld.senderAccountID = msg.sender;
                    _nftTransferOld.receiverAccountID = address(this);
                    _nftTransferOld.serialNumber = int64(
                        serialToSwap.toUint64()
                    );
                    _transfersFromEOA[inner].nftTransfers[0] = _nftTransferOld;

                    // transfer from SC to Treasury
                    _transfersSCToTsry[inner].token = tokenToSwap;
                    _transfersSCToTsry[inner]
                        .nftTransfers = new IHederaTokenService.NftTransfer[](
                        1
                    );

                    IHederaTokenService.NftTransfer
                        memory _nftTransferOldToTsry;
                    _nftTransferOldToTsry.senderAccountID = address(this);
                    _nftTransferOldToTsry.receiverAccountID = swapTokenTreasury;
                    _nftTransferOldToTsry.serialNumber = int64(
                        serialToSwap.toUint64()
                    );
                    _transfersSCToTsry[inner].nftTransfers[
                        0
                    ] = _nftTransferOldToTsry;

                    // transfer from SC to EOA
                    _transfersToEOA[inner].token = swapToken;
                    _transfersToEOA[inner]
                        .nftTransfers = new IHederaTokenService.NftTransfer[](
                        1
                    );

                    IHederaTokenService.NftTransfer memory _nftTransferNew;
                    _nftTransferNew.senderAccountID = address(this);
                    _nftTransferNew.receiverAccountID = msg.sender;
                    _nftTransferNew.serialNumber = int64(newSerial.toUint64());
                    _transfersToEOA[inner].nftTransfers[0] = _nftTransferNew;

                    // emit the event
                    emit TokenSwapEvent(
                        msg.sender,
                        tokenToSwap,
                        serialToSwap,
                        swapToken,
                        newSerial,
                        "Swapped"
                    );
                } else {
                    revert ConfigNotFound(tokenToSwap, serials[outer + inner]);
                }
            }
            // now add the $LAZY transfers

            // 1. From EOA to SC
            _transfersFromEOA[arraySze - 1]
                .transfers = new IHederaTokenService.AccountAmount[](2);
            _transfersFromEOA[arraySze - 1].token = lazyToken;

            IHederaTokenService.AccountAmount memory _sendAccountAmount;
            _sendAccountAmount.accountID = address(this);
            _sendAccountAmount.amount = -1;
            _transfersFromEOA[arraySze - 1].transfers[0] = _sendAccountAmount;

            IHederaTokenService.AccountAmount memory _recieveAccountAmount;
            _recieveAccountAmount.accountID = msg.sender;
            _recieveAccountAmount.amount = 1;
            _transfersFromEOA[arraySze - 1].transfers[
                1
            ] = _recieveAccountAmount;

            // transfer the NFTs
            responseCode = HederaTokenService.cryptoTransfer(_transfersFromEOA);
            if (responseCode != HederaResponseCodes.SUCCESS) {
                revert NFTEOA2SCTransferFailed();
            }

            // 2. From SC to Treasury
            _transfersSCToTsry[arraySze - 1]
                .transfers = new IHederaTokenService.AccountAmount[](2);
            _transfersSCToTsry[arraySze - 1].token = lazyToken;

            _sendAccountAmount.accountID = swapTokenTreasury;
            _sendAccountAmount.amount = -1;
            _transfersSCToTsry[arraySze - 1].transfers[0] = _sendAccountAmount;

            _recieveAccountAmount.accountID = address(this);
            _recieveAccountAmount.amount = 1;
            _transfersSCToTsry[arraySze - 1].transfers[
                1
            ] = _recieveAccountAmount;

            // transfer the NFTs
            responseCode = HederaTokenService.cryptoTransfer(
                _transfersSCToTsry
            );
            if (responseCode != HederaResponseCodes.SUCCESS) {
                revert NFTSC2TreasuryTransferFailed();
            }

            // 3. From SC to EOA
            _transfersToEOA[arraySze - 1]
                .transfers = new IHederaTokenService.AccountAmount[](2);
            _transfersToEOA[arraySze - 1].token = lazyToken;

            _sendAccountAmount.accountID = msg.sender;
            _sendAccountAmount.amount = -1;
            _transfersToEOA[arraySze - 1].transfers[0] = _sendAccountAmount;

            _recieveAccountAmount.accountID = address(this);
            _recieveAccountAmount.amount = 1;
            _transfersToEOA[arraySze - 1].transfers[1] = _recieveAccountAmount;

            // transfer the NFTs
            responseCode = HederaTokenService.cryptoTransfer(_transfersToEOA);
            if (responseCode != HederaResponseCodes.SUCCESS) {
                revert NFTSC2EOATransferFailed();
            }
        }

        // send the lazy to the user
        if (amt == 0) return 0;

        uint256 paid = lazyGasStation.payoutLazy(msg.sender, amt, 0);
        if (paid != amt) revert FTTransferFailed();

        emit TokenSwapEvent(
            msg.sender,
            address(lazyGasStation),
            0,
            lazyToken,
            amt,
            "$LAZY sent"
        );
    }

    /// @notice Stakes NFTs from user to contract for swap distribution
    /// @dev Used when NFTs are held outside treasury and need to be loaded into contract
    /// @param _serials Array of serial numbers to stake
    function stakeNFTs(uint256[] calldata _serials) external {
        if (IERC20(lazyToken).balanceOf(address(this)) < 20) {
            lazyGasStation.refillLazy(50);
        }
        address receiverAddress = address(this);
        address senderAddress = msg.sender;

        uint256 length = _serials.length;
        for (
            uint256 outer = 0;
            outer < _serials.length;
            outer += MAX_NFTS_PER_TX
        ) {
            uint256 batchSize = (length - outer) >= MAX_NFTS_PER_TX
                ? MAX_NFTS_PER_TX
                : (length - outer);
            uint256[] memory serials = new uint256[](batchSize);
            for (
                uint256 inner = 0;
                ((outer + inner) < length) && (inner < MAX_NFTS_PER_TX);
                ++inner
            ) {
                if (outer + inner < length) {
                    serials[inner] = _serials[outer + inner];
                }
            }

            // sized to a single move, expandable to up to 10 elements (untested)
            IHederaTokenService.TokenTransferList[]
                memory _transfers = new IHederaTokenService.TokenTransferList[](
                    serials.length + 1
                );
            //transfer lazy token
            _transfers[0].transfers = new IHederaTokenService.AccountAmount[](
                2
            );
            _transfers[0].token = lazyToken;

            IHederaTokenService.AccountAmount memory _sendAccountAmount;
            _sendAccountAmount.accountID = receiverAddress;
            _sendAccountAmount.amount = -1;
            _transfers[0].transfers[0] = _sendAccountAmount;

            IHederaTokenService.AccountAmount memory _receiveAccountAmount;
            _receiveAccountAmount.accountID = senderAddress;
            _receiveAccountAmount.amount = 1;
            _transfers[0].transfers[1] = _receiveAccountAmount;

            // transfer NFT
            for (uint256 i = 0; i < serials.length; ++i) {
                IHederaTokenService.NftTransfer memory _nftTransfer;
                _nftTransfer.senderAccountID = senderAddress;
                _nftTransfer.receiverAccountID = receiverAddress;
                if (serials[i] == 0) {
                    continue;
                }
                _transfers[i + 1].token = swapToken;
                _transfers[i + 1]
                    .nftTransfers = new IHederaTokenService.NftTransfer[](1);

                _nftTransfer.serialNumber = SafeCast.toInt64(
                    int256(serials[i])
                );
                _transfers[i + 1].nftTransfers[0] = _nftTransfer;
            }

            int256 response = HederaTokenService.cryptoTransfer(_transfers);

            if (response != HederaResponseCodes.SUCCESS) {
                // could be $LAZY or serials causing the issue. Check $LAZY balance of contract first
                revert StakingFailed();
            }
        }
    }

    /// @notice Transfers HBAR out of the contract using secure transfer pattern
    /// @dev Uses OpenZeppelin Address.sendValue with 2300 gas limit to prevent reentrancy
    /// @param receiverAddress Address to receive the HBAR
    /// @param amount Amount to send in tinybars
    function transferHbar(
        address payable receiverAddress,
        uint256 amount
    ) external onlyOwner {
        if (receiverAddress == address(0) || amount == 0) revert BadInput();

        Address.sendValue(receiverAddress, amount);

        emit TokenSwapEvent(
            receiverAddress,
            address(0),
            amount,
            address(0),
            0,
            "Hbar Transfer Complete"
        );
    }

    /// @notice Retrieves LAZY tokens from contract to specified address
    /// @param _receiver Address to receive the LAZY tokens
    /// @param _amount Amount of LAZY tokens to transfer
    function retrieveLazy(address _receiver, int64 _amount) external onlyOwner {
        if (_receiver == address(0) || _amount == 0) {
            revert BadInput();
        }
        // given latest Hedera security model need to move to allowance spends
        int256 responseCode = transferToken(
            lazyToken,
            address(this),
            _receiver,
            _amount
        );

        if (responseCode != HederaResponseCodes.SUCCESS) {
            revert FTTransferFailed();
        }
    }

    /// @notice Handles direct HBAR transfers to the contract
    receive() external payable {
        emit TokenSwapEvent(
            msg.sender,
            address(0),
            msg.value,
            address(0),
            0,
            "Hbar Received by Contract"
        );
    }

    /// @notice Fallback function for HBAR transfers with data
    fallback() external payable {
        emit TokenSwapEvent(
            msg.sender,
            address(0),
            msg.value,
            address(0),
            0,
            "Fallback Called"
        );
    }
}
