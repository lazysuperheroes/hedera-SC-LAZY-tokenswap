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

import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {
    EnumerableMap
} from "@openzeppelin/contracts/utils/structs/EnumerableMap.sol";

/// @title NoFallbackTokenSwap
/// @author Lazy Superheroes (lazysuperheroes.com)
/// @notice NFT swap contract for exchanging legacy NFTs for new collection NFTs with LAZY rewards
/// @dev Basic swap implementation without LazyGasStation auto-refill
contract NoFallbackTokenSwap is BaseTokenSwap {
    using EnumerableMap for EnumerableMap.Bytes32ToUintMap;
    using SafeCast for uint256;

    error NFTTransferFailed();

    /// @notice Initializes the NoFallbackTokenSwap contract
    /// @param _swapToken Address of the new NFT collection to distribute
    /// @param _swapTokenTreasury Treasury address to receive old NFTs
    /// @param _lgs LazyGasStation contract address for access control
    /// @param _lazy LAZY token address for rewards
    constructor(
        address _swapToken,
        address _swapTokenTreasury,
        address _lgs,
        address _lazy
    ) BaseTokenSwap(_swapToken, _swapTokenTreasury, _lgs, _lazy) {
        int256 responseCode = associateToken(address(this), _swapToken);

        if (
            !(responseCode == HederaResponseCodes.SUCCESS ||
                responseCode ==
                HederaResponseCodes.TOKEN_ALREADY_ASSOCIATED_TO_ACCOUNT)
        ) {
            revert AssociationFailed();
        }
    }

    /// @notice Swaps old NFTs for new collection NFTs with LAZY token rewards
    /// @dev Processes swaps in batches of 5 due to Hedera transfer limits
    /// @param tokensToSwap Array of old NFT token addresses to swap
    /// @param serials Array of serial numbers of the old NFTs to swap
    /// @return amt Total LAZY tokens paid out for the swaps
    function swapNFTs(
        address[] calldata tokensToSwap,
        uint256[] calldata serials
    ) external returns (uint256 amt) {
        if (serials.length > type(uint8).max) revert ExceedsMaxSerials();
        if (tokensToSwap.length != serials.length) revert BadInput();
        if (paused) revert ContractPaused();
        int256 responseCode;

        /*
         * each NFT transfer can move 10 serials for a single token ID
         * the transfer array must be sized correctly with no empty gaps
         * so we need to iterate through and find the grouping of contiguous token IDs
         * then head to this method to loop around them in an attempt to be efficient
         * When sending the swap input we need to ensure we group tokens together
         */
        for (uint256 outer = 0; outer < serials.length; outer += 5) {
            // outer loop to group transfers efficiently in bundles of 5
            // 5 old swapped for 5 new -> 10 max per tx
            uint256 arraySze = Math.min(serials.length - outer, 5) * 2;
            IHederaTokenService.TokenTransferList[]
                memory _transfers = new IHederaTokenService.TokenTransferList[](
                    arraySze
                );
            // inner loop to group transfers efficiently in bundles of 5
            for (
                uint8 inner = 0;
                (inner < 5) && (outer + inner < serials.length);
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
                    /*
                     *	Removed the check if the user owns the serial as each check spawns
                     * 	a seperate child tx and there is a 50 child tx limit. The benefit of
                     *	having this is that a contract badly specified can still work. e.g
                     *	users has 10 serials to burn but just sold one and clicks the button
                     *	before the mirror node is updated. If we check we can just send 9 and
                     *	ignore the item not owned. The downside is it limits the number than can
                     *	be processed in one go due to child tx. Given the network enforces only
                     *	moving tokens owned this can be dispensed with and if serials supplied
                     *	contain any not owned it will just fail wasting gas - clear benefit is
                     *	can handle bulk much faster.
                     */

                    // calculate amount to send
                    amt += lazyPmtAmt;

                    // update the record
                    hashToSerialMap.remove(swapHash);

                    _transfers[inner * 2].token = tokenToSwap;
                    _transfers[inner * 2]
                        .nftTransfers = new IHederaTokenService.NftTransfer[](
                        1
                    );

                    IHederaTokenService.NftTransfer memory _nftTransferOld;
                    _nftTransferOld.senderAccountID = msg.sender;
                    _nftTransferOld.receiverAccountID = swapTokenTreasury;
                    _nftTransferOld.serialNumber = int64(
                        serialToSwap.toUint64()
                    );
                    _transfers[inner * 2].nftTransfers[0] = _nftTransferOld;

                    _transfers[inner * 2 + 1].token = swapToken;
                    _transfers[inner * 2 + 1]
                        .nftTransfers = new IHederaTokenService.NftTransfer[](
                        1
                    );

                    IHederaTokenService.NftTransfer memory _nftTransferNew;
                    _nftTransferNew.senderAccountID = address(this);
                    _nftTransferNew.receiverAccountID = msg.sender;
                    _nftTransferNew.serialNumber = int64(newSerial.toUint64());
                    _transfers[inner * 2 + 1].nftTransfers[0] = _nftTransferNew;

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
            // transfer the NFTs
            responseCode = cryptoTransfer(_transfers);
            if (responseCode != HederaResponseCodes.SUCCESS) {
                revert NFTTransferFailed();
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
}
