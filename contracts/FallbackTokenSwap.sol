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
import {IHederaTokenService} from "./interfaces/IHederaTokenService.sol";
import {BaseTokenSwap} from "./BaseTokenSwap.sol";

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {
    EnumerableMap
} from "@openzeppelin/contracts/utils/structs/EnumerableMap.sol";

/// @title FallbackTokenSwap
/// @author Lazy Superheroes (lazysuperheroes.com)
/// @notice NFT swap contract with LazyGasStation integration for automatic gas refills
/// @dev Enables swapping legacy NFTs for new collection NFTs with LAZY token rewards
contract FallbackTokenSwap is BaseTokenSwap {
    using EnumerableMap for EnumerableMap.Bytes32ToUintMap;
    using SafeCast for uint256;

    error NFTEOA2SCTransferFailed();
    error NFTSC2TreasuryTransferFailed();
    error NFTSC2EOATransferFailed();
    error StakingFailed();

    uint256 private constant MAX_NFTS_PER_TX = 8;

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
    ) BaseTokenSwap(_swapToken, _swapTokenTreasury, _lgs, _lazy) {
        // create an address array of lazy token and swap token
        address[] memory _tokens = new address[](2);
        _tokens[0] = lazyToken;
        _tokens[1] = swapToken;

        int256 responseCode = associateTokens(address(this), _tokens);

        if (responseCode != HederaResponseCodes.SUCCESS) {
            revert AssociationFailed();
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

    /// @notice Swaps old NFTs for new NFTs and pays LAZY rewards
    /// @dev Performs 3 transfers per NFT: EOA→SC, SC→Treasury, SC→EOA (new NFT)
    /// @param tokensToSwap Array of old NFT token addresses to swap
    /// @param serials Array of serial numbers of the NFTs to transfer
    /// @return amt Total LAZY tokens paid as rewards
    function swapNFTs(
        address[] calldata tokensToSwap,
        uint256[] calldata serials
    ) external nonReentrant returns (uint256 amt) {
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
            responseCode = cryptoTransfer(_transfersFromEOA);
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
            responseCode = cryptoTransfer(
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
            responseCode = cryptoTransfer(_transfersToEOA);
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
    function stakeNFTs(uint256[] calldata _serials) external nonReentrant {
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

            int256 response = cryptoTransfer(_transfers);

            if (response != HederaResponseCodes.SUCCESS) {
                // could be $LAZY or serials causing the issue. Check $LAZY balance of contract first
                revert StakingFailed();
            }
        }
    }
}
