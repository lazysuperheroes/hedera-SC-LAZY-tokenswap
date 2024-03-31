// SPDX-License-Identifier: GPL-3.0
pragma solidity >=0.8.12 <0.9.0;

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
import {EnumerableMap} from "@openzeppelin/contracts/utils/structs/EnumerableMap.sol";

contract FallbackTokenSwap is HederaTokenService, Ownable {
	using EnumerableMap for EnumerableMap.Bytes32ToUintMap;
	using SafeCast for uint256;

	error BadInput();
	error ConfigNotFound(address token, uint256 serial);

	uint256 private constant MAX_NFTS_PER_TX = 8;

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

		// creat an address array of lazy token and swap token
		address[] memory _tokens = new address[](2);
		_tokens[0] = lazyToken;
		_tokens[1] = swapToken;

		int256 responseCode = associateTokens(address(this), _tokens);

		if (responseCode != HederaResponseCodes.SUCCESS) {
            revert("Associating Tokens failed");
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
		// not checking for success as it will fail if already associated
		associateToken(address(this), swapToken);
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

	function prepareForStakedSwap(address[] calldata _tokens) external onlyOwner {
		int256 responseCode = associateTokens(address(this), _tokens);

		if (responseCode != HederaResponseCodes.SUCCESS) {
			revert("Batch Associating Tokens failed");
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
        require(serials.length <= type(uint8).max, "Too many serials");
		require(tokensToSwap.length == serials.length, "Tokens != serials");
		require(!paused, "Contract is paused");
		int256 responseCode;

		/* 
			We will be doing 3 transfers per NFT
			1. Old From EOA to SC
			2. Old From SC to Treasury
			3. New From SC to EOA
		*/
		for(uint256 outer = 0; outer < serials.length; outer += 8) {
			// outer loop to group transfers efficiently in bundles of 8
			// add 1 extra transfer slot for the $LAZY transfer (made of two legs)
			uint256 arraySze = Math.min(serials.length - outer, 8) + 1;
			IHederaTokenService.TokenTransferList[] memory _transfersFromEOA = new IHederaTokenService.TokenTransferList[](arraySze);
			IHederaTokenService.TokenTransferList[] memory _transfersSCToTsry = new IHederaTokenService.TokenTransferList[](arraySze);
			IHederaTokenService.TokenTransferList[] memory _transfersToEOA = new IHederaTokenService.TokenTransferList[](arraySze);
			// inner loop to group transfers efficiently in bundles of 8
			for (uint8 inner = 0; (inner < 8) && (outer + inner < serials.length); inner++	) {
				// check the NFT is burn eligible
				address tokenToSwap = tokensToSwap[outer + inner];
				uint256 serialToSwap = serials[outer + inner];
				bytes32 swapHash = keccak256(abi.encodePacked(tokenToSwap, serialToSwap));
				(bool found, uint256 newSerial) = hashToSerialMap.tryGet(swapHash);
				if (found) {

					// calculate amount to send
					amt += lazyPmtAmt;

					// update the record
					hashToSerialMap.remove(swapHash);

					// transfer From EOA to SC
					_transfersFromEOA[inner].token = tokenToSwap;
					_transfersFromEOA[inner].nftTransfers = new IHederaTokenService.NftTransfer[](1);

					IHederaTokenService.NftTransfer memory _nftTransferOld;
					_nftTransferOld.senderAccountID = msg.sender;
					_nftTransferOld.receiverAccountID = address(this);
					_nftTransferOld.serialNumber = int64(serialToSwap.toUint64());
					_transfersFromEOA[inner].nftTransfers[0] = _nftTransferOld;

					// transfer from SC to Treasury
					_transfersSCToTsry[inner].token = tokenToSwap;
					_transfersSCToTsry[inner].nftTransfers = new IHederaTokenService.NftTransfer[](1);

					IHederaTokenService.NftTransfer memory _nftTransferOldToTsry;
					_nftTransferOldToTsry.senderAccountID = address(this);
					_nftTransferOldToTsry.receiverAccountID = swapTokenTreasury;
					_nftTransferOldToTsry.serialNumber = int64(serialToSwap.toUint64());
					_transfersSCToTsry[inner].nftTransfers[0] = _nftTransferOldToTsry;


					// transfer from SC to EOA
					_transfersToEOA[inner].token = swapToken;
					_transfersToEOA[inner].nftTransfers = new IHederaTokenService.NftTransfer[](1);

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
				}
				else {
					revert ConfigNotFound(tokenToSwap, serials[outer + inner]);
				}
			}
			// now add the $LAZY transfers

			// 1. From EOA to SC
			_transfersFromEOA[arraySze - 1].transfers = new IHederaTokenService.AccountAmount[](2);
			_transfersFromEOA[arraySze - 1].token = lazyToken;

			IHederaTokenService.AccountAmount memory _sendAccountAmount;
			_sendAccountAmount.accountID = address(this);
			_sendAccountAmount.amount = -1;
			_transfersFromEOA[arraySze - 1].transfers[0] = _sendAccountAmount;

			IHederaTokenService.AccountAmount memory _recieveAccountAmount;
			_recieveAccountAmount.accountID = msg.sender;
			_recieveAccountAmount.amount = 1;
			_transfersFromEOA[arraySze - 1].transfers[1] = _recieveAccountAmount;

			// transfer the NFTs
			responseCode = HederaTokenService.cryptoTransfer(_transfersFromEOA);
			if (responseCode != HederaResponseCodes.SUCCESS) {
            	revert("TokenSwap (step 1) NFT Transfer failed");
        	}

			// 2. From SC to Treasury
			_transfersSCToTsry[arraySze - 1].transfers = new IHederaTokenService.AccountAmount[](2);
			_transfersSCToTsry[arraySze - 1].token = lazyToken;

			_sendAccountAmount.accountID = swapTokenTreasury;
			_sendAccountAmount.amount = -1;
			_transfersSCToTsry[arraySze - 1].transfers[0] = _sendAccountAmount;

			_recieveAccountAmount.accountID = address(this);
			_recieveAccountAmount.amount = 1;
			_transfersSCToTsry[arraySze - 1].transfers[1] = _recieveAccountAmount;

			// transfer the NFTs
			responseCode = HederaTokenService.cryptoTransfer(_transfersSCToTsry);
			if (responseCode != HederaResponseCodes.SUCCESS) {
				revert("TokenSwap (step 2) NFT Transfer failed");
			}

			// 3. From SC to EOA
			_transfersToEOA[arraySze - 1].transfers = new IHederaTokenService.AccountAmount[](2);
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
				revert("TokenSwap (step 3) NFT Transfer failed");
			}
			
		}

		// send the lazy to the user
		if (amt == 0) return 0;

		uint256 paid = lazyGasStation.payoutLazy(msg.sender, amt, 0);
		if (paid != amt) revert("TokenSwap FT Transfer failed");

        emit TokenSwapEvent(
            msg.sender,
			address(lazyGasStation),
            0,
			lazyToken,
			amt,
			"$LAZY sent"
        );
    }

	// if the NFTs are held outside of the treasury we need a method topush them up 
	// to the contract before the swap can be completed
	function stakeNFTs(uint256[] calldata _serials) external {
		if(IERC20(lazyToken).balanceOf(address(this)) < 20) {
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
                ((outer + inner) < length) &&
                    (inner < MAX_NFTS_PER_TX);
                inner++
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
			_transfers[0].transfers = new IHederaTokenService.AccountAmount[](2);
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
			for (uint256 i = 0; i < serials.length; i++) {
				IHederaTokenService.NftTransfer memory _nftTransfer;
				_nftTransfer.senderAccountID = senderAddress;
				_nftTransfer.receiverAccountID = receiverAddress;
				if (serials[i] == 0) {
					continue;
				}
				_transfers[i + 1].token = swapToken;
				_transfers[i + 1]
					.nftTransfers = new IHederaTokenService.NftTransfer[](1);

				_nftTransfer.serialNumber = SafeCast.toInt64(int256(serials[i]));
				_transfers[i + 1].nftTransfers[0] = _nftTransfer;
			}

			int256 response = HederaTokenService.cryptoTransfer(_transfers);

			if (response != HederaResponseCodes.SUCCESS) {
				// could be $LAZY or serials causing the issue. Check $LAZY balance of contract first
				revert("Staking tfer fail");
			}
        }

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