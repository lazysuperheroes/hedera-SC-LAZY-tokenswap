// SPDX-License-Identifier: GPL-3.0
pragma solidity >=0.8.12 <0.9.0;

import {HederaResponseCodes} from "./HederaResponseCodes.sol";
import {HederaTokenService} from "./HederaTokenService.sol";
import {IHederaTokenService} from "./interfaces/IHederaTokenService.sol";

import {ILazyGasStation} from "./interfaces/ILazyGasStation.sol";

// Import OpenZeppelin Contracts where needed
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {EnumerableMap} from "@openzeppelin/contracts/utils/structs/EnumerableMap.sol";

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

	address public swapToken;
	address public swapTokenTreasury;
	address public lazyToken;
	ILazyGasStation public lazyGasStation;

	uint256 public lazyPmtAmt;

	EnumerableMap.Bytes32ToUintMap private hashToSerialMap;

	bool public paused;

	event TokenSwapEvent(
        address indexed user,
        address indexed oldToken,
		uint256 oldSerial,
		address indexed newToken,
		uint256 newSerial,
        string message
    );

    constructor(
		address _swapToken,
		address _swapTokenTreasury,
		address _lgs, 
		address _lazy) {

		swapToken = _swapToken;
		swapTokenTreasury = _swapTokenTreasury;
		lazyToken = _lazy;
		lazyGasStation = ILazyGasStation(_lgs);

		paused = true;

		int256 responseCode = associateToken(address(this), _swapToken);

		if (!(responseCode == HederaResponseCodes.SUCCESS || responseCode == HederaResponseCodes.TOKEN_ALREADY_ASSOCIATED_TO_ACCOUNT)) {
            revert AssociationFailed();
        }
    }

	/// @param _paused boolean to pause (true) or release (false)
	/// @return changed indicative of whether a change was made
	function updatePauseStatus(bool _paused) external onlyOwner returns (bool changed) {
		changed = _paused == paused ? false : true;
		if (changed) {
			emit TokenSwapEvent(msg.sender, address(0), 0, address(0), 0, paused ? "PAUSED" : "UNPAUSED");
		}
		paused = _paused;
	}

	function updateLGS(address _lgs) external onlyOwner {
		if (_lgs == address(0)) revert BadInput();
		lazyGasStation = ILazyGasStation(_lgs);
	}

	function updateLazyToken(address _lazy) external onlyOwner {
		if (_lazy == address(0)) revert BadInput();
		lazyToken = _lazy;
	}

	function updateSwapToken(address _swapToken) external onlyOwner {
		if (_swapToken == address(0)) revert BadInput();
		swapToken = _swapToken;

		// associate the new token with this contract
		int256 responseCode = associateToken(address(this), swapToken);
		if (!(responseCode == HederaResponseCodes.SUCCESS || responseCode == HederaResponseCodes.TOKEN_ALREADY_ASSOCIATED_TO_ACCOUNT)) {
			revert AssociationFailed();
		}
	}

	function updateClaimAmount(uint256 _amount) external onlyOwner {
		lazyPmtAmt = _amount;
	}

	function updateSwapConfig(uint256[] calldata newSerials, bytes32[] calldata swapHashes) external onlyOwner {
		if (newSerials.length != swapHashes.length) revert BadInput();

		uint256 length = newSerials.length;
		for(uint256 i = 0; i < length;) {
			hashToSerialMap.set(swapHashes[i], newSerials[i]);
			unchecked { ++i; }
		}
	}

	function removeSwapConfig(bytes32[] calldata _swapHashes) external onlyOwner {
		uint256 length = _swapHashes.length;
		for(uint256 i = 0; i < length;) {
			hashToSerialMap.remove(_swapHashes[i]);
			unchecked { ++i; }
		}
	}

	function getSerials(bytes32[] calldata swapHashes) external view returns (uint256[] memory serials) {
		serials = new uint256[](swapHashes.length);
		uint256 length = swapHashes.length;
		for(uint256 i = 0; i < length; ) {
			serials[i] = hashToSerialMap.get(swapHashes[i]);
			unchecked { ++i; }
		}
	}

	/// @param serials array of serial numbers of the NFTs to transfer
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
		for(uint256 outer = 0; outer < serials.length; outer += 5) {
			// outer loop to group transfers efficiently in bundles of 5
			// 5 old swapped for 5 new -> 10 max per tx
			uint256 arraySze = Math.min(serials.length - outer, 5) * 2;
			IHederaTokenService.TokenTransferList[] memory _transfers = new IHederaTokenService.TokenTransferList[](arraySze);
			// inner loop to group transfers efficiently in bundles of 5
			for (uint8 inner = 0; (inner < 5) && (outer + inner < serials.length); inner++	) {
				// check the NFT is burn eligible
				address tokenToSwap = tokensToSwap[outer + inner];
				uint256 serialToSwap = serials[outer + inner];
				bytes32 swapHash = keccak256(abi.encodePacked(tokenToSwap, serialToSwap));
				(bool found, uint256 newSerial) = hashToSerialMap.tryGet(swapHash);
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
					_transfers[inner * 2].nftTransfers = new IHederaTokenService.NftTransfer[](1);

					IHederaTokenService.NftTransfer memory _nftTransferOld;
					_nftTransferOld.senderAccountID = msg.sender;
					_nftTransferOld.receiverAccountID = swapTokenTreasury;
					_nftTransferOld.serialNumber = int64(serialToSwap.toUint64());
					_transfers[inner * 2].nftTransfers[0] = _nftTransferOld;

					_transfers[inner * 2 + 1].token = swapToken;
					_transfers[inner * 2 + 1].nftTransfers = new IHederaTokenService.NftTransfer[](1);

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
				}
				else {
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

    // Transfer hbar oput of the contract - using secure ether transfer pattern
    // on top of onlyOwner as max gas of 2300 (not adjustable) will limit re-entrrant attacks
    // also throws error on failure causing contract to auutomatically revert
    /// @param receiverAddress address in EVM fomat of the reciever of the token
    /// @param amount number of tokens to send (in tinybar i.e. adjusted for decimal)
    function transferHbar(address payable receiverAddress, uint256 amount)
        external
        onlyOwner
    {
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

	function retrieveLazy(
		address _receiver,
		int64 _amount
	) external onlyOwner {
		if (_receiver == address(0) || _amount == 0) {
			revert("Invalid address or amount");
		}
		// given latest Hedera security model need to move to allowance spends
		int256 responseCode = transferToken(
			lazyToken,
			address(this),
			_receiver,
			_amount
		);

		if (responseCode != HederaResponseCodes.SUCCESS) {
			revert("transferHTS - failed");
		}
	}


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