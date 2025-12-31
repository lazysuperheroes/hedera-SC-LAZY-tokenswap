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
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {
    EnumerableMap
} from "@openzeppelin/contracts/utils/structs/EnumerableMap.sol";

/// @title NoFallbackTokenSwap
/// @author Lazy Superheroes (lazysuperheroes.com)
/// @notice NFT swap contract for exchanging legacy NFTs for new collection NFTs with LAZY rewards
/// @dev Basic swap implementation without LazyGasStation auto-refill
contract NoFallbackTokenSwap is HederaTokenService, Ownable {
    using EnumerableMap for EnumerableMap.Bytes32ToUintMap;
    using SafeCast for uint256;

    error BadInput();
    error ExceedsMaxSerials();
    error ConfigNotFound(address token, uint256 serial);
    error AssociationFailed();
    error ContractPaused();
    error NFTTransferFailed();
    error FTTransferFailed();

    /// @notice Address of the NFT collection being swapped (new tokens to distribute)
    address public swapToken;
    /// @notice Treasury address where old NFTs are sent after swap
    address public swapTokenTreasury;
    /// @notice Address of the LAZY token used for rewards
    address public lazyToken;
    /// @notice LazyGasStation contract reference (used for access control)
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
    ) Ownable(msg.sender) {
        swapToken = _swapToken;
        swapTokenTreasury = _swapTokenTreasury;
        lazyToken = _lazy;
        lazyGasStation = ILazyGasStation(_lgs);

        paused = true;

        int256 responseCode = associateToken(address(this), _swapToken);

        if (
            !(responseCode == HederaResponseCodes.SUCCESS ||
                responseCode ==
                HederaResponseCodes.TOKEN_ALREADY_ASSOCIATED_TO_ACCOUNT)
        ) {
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

    /// @notice Removes swap configuration entries by hash
    /// @param _swapHashes Array of swap hashes to remove from the mapping
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
    /// @return serials Array of corresponding new NFT serial numbers (0 if not found)
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
            responseCode = HederaTokenService.cryptoTransfer(_transfers);
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

    /// @notice Transfers HBAR from contract to specified address
    /// @dev Uses secure ether transfer pattern with max gas limit of 2300 to prevent reentrancy
    /// @param receiverAddress Address in EVM format to receive the HBAR
    /// @param amount Amount of HBAR to send in tinybar (1 HBAR = 100,000,000 tinybar)
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
    /// @dev Owner-only emergency function to recover LAZY tokens
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
    /// @dev Emits event to track incoming HBAR payments
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

    /// @notice Fallback function for calls with data that don't match any function
    /// @dev Accepts HBAR and emits tracking event
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
