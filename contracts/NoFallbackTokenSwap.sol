// SPDX-License-Identifier: GPL-3.0
pragma solidity >=0.8.12 <0.9.0;

import "./HederaResponseCodes.sol";
import "./HederaTokenService.sol";

// Import OpenZeppelin Contracts where needed
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/utils/Strings.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableMap.sol";

contract NoFallbackTokenSwap is HederaTokenService, Ownable {
	using EnumerableMap for EnumerableMap.Bytes32ToUintMap;
	using SafeCast for uint256;

	address private _swapToken;
	address private _swapTokenTreasury;
	address private _lazyToken;
	address private _lazySCT;

	uint256 private _lazyPmtAmt;

	EnumerableMap.Bytes32ToUintMap private _hashToSerialMap;

	bool private _paused;

	event TokenSwapEvent(
        address indexed user,
        address indexed oldToken,
		uint256 oldSerial,
		address indexed newToken,
		uint256 newSerial,
        string message
    );

    constructor(
		address swapToken,
		address swapTokenTreasury,
		address lsct, 
		address lazy) {

		_swapToken = swapToken;
		_swapTokenTreasury = swapTokenTreasury;
		_lazyToken = lazy;
		_lazySCT = lsct;

		_paused = true;

		int responseCode = associateToken(address(this), _swapToken);

		if (responseCode != HederaResponseCodes.SUCCESS) {
            revert("Associating Swap Token failed");
        }
    }

	/// @param paused boolean to pause (true) or release (false)
	/// @return changed indicative of whether a change was made
	function updatePauseStatus(bool paused) external onlyOwner returns (bool changed) {
		changed = _paused == paused ? false : true;
		if (changed) {
			emit TokenSwapEvent(msg.sender, address(0), 0, address(0), 0, string.concat(paused ? "PAUSED @ " : "UNPAUSED @ ", Strings.toString(block.timestamp)));
		}
		_paused = paused;
	}

	function updateSCT(address sct) external onlyOwner {
		require(sct != address(0), "SCT cannot be zero address");
		_lazySCT = sct;
	}

	function updateLazyToken(address lazy) external onlyOwner {
		require(lazy != address(0), "Lazy cannot be zero address");
		_lazyToken = lazy;
	}

	function updateSwapToken(address swapToken) external onlyOwner {
		require(swapToken != address(0), "New Token cannot be zero address");
		_swapToken = swapToken;

		// associate the new token with this contract
		// not checking for success as it will fail if already associated
		associateToken(address(this), _swapToken);
	}

	function updateClaimAmount(uint256 amount) external onlyOwner {
		_lazyPmtAmt = amount;
	}

	function updateSwapConfig(uint[] calldata newSerials, bytes32[] calldata swapHashes) external onlyOwner {
		require(newSerials.length == swapHashes.length, "Serials != hashes length");

		for(uint256 i = 0; i < newSerials.length; i++) {
			_hashToSerialMap.set(swapHashes[i], newSerials[i]);
		}
	}

	function removeSwapConfig(bytes32[] calldata swapHashes) external onlyOwner {
		for(uint256 i = 0; i < swapHashes.length; i++) {
			_hashToSerialMap.remove(swapHashes[i]);
		}
	}

	function getClaimAmount() external view returns (uint256 amt) {
		amt = _lazyPmtAmt;
	}

	function getSerials(bytes32[] calldata swapHashes) external view returns (uint256[] memory serials) {
		serials = new uint256[](swapHashes.length);
		for(uint256 i = 0; i < swapHashes.length; i++) {
			serials[i] = _hashToSerialMap.get(swapHashes[i]);
		}
	}

	/// @param serials array of serial numbers of the NFTs to transfer
    function swapNFTs(
		address[] calldata tokensToSwap,
        uint256[] calldata serials
    ) external payable returns (uint amt) {
        require(serials.length <= type(uint8).max, "Too many serials");
		require(tokensToSwap.length == serials.length, "Tokens != serials");
		require(!_paused, "Contract is paused");
		int responseCode;

		// if we are going to pay $LAZY
		// then check if user has associated token
		if (_lazyPmtAmt > 0) {
			if(IERC721(_lazyToken).balanceOf(msg.sender) == 0) associateToken(msg.sender, _lazyToken);
		}

		if (IERC721(_swapToken).balanceOf(msg.sender) == 0) associateToken(msg.sender, _swapToken);

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
			uint arraySze = Math.min(serials.length - outer, 5) * 2;
			IHederaTokenService.TokenTransferList[] memory _transfers = new IHederaTokenService.TokenTransferList[](arraySze);
			// inner loop to group transfers efficiently in bundles of 5
			for (uint8 inner = 0; (inner < 5) && (outer + inner < serials.length); inner++	) {
				// check the NFT is burn eligible
				address tokenToSwap = tokensToSwap[outer + inner];
				uint serialToSwap = serials[outer + inner];
				bytes32 swapHash = keccak256(abi.encodePacked(tokenToSwap, serialToSwap));
				(bool found, uint newSerial) = _hashToSerialMap.tryGet(swapHash);
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
					amt += _lazyPmtAmt;

					// update the record
					_hashToSerialMap.remove(swapHash);

					_transfers[inner * 2].token = tokenToSwap;
					_transfers[inner * 2].nftTransfers = new IHederaTokenService.NftTransfer[](1);

					IHederaTokenService.NftTransfer memory _nftTransferOld;
					_nftTransferOld.senderAccountID = msg.sender;
					_nftTransferOld.receiverAccountID = _swapTokenTreasury;
					_nftTransferOld.serialNumber = int64(serialToSwap.toUint64());
					_transfers[inner * 2].nftTransfers[0] = _nftTransferOld;

					_transfers[inner * 2 + 1].token = _swapToken;
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
						_swapToken,
						newSerial,
						"Swapped"
					);
				}
				else {
					revert(string.concat("Config Not found ", Strings.toHexString(uint256(uint160(tokenToSwap)), 20), " /#", Strings.toString(serials[outer + inner])));
				}
			}
			// transfer the NFTs
			responseCode = HederaTokenService.cryptoTransfer(_transfers);
			if (responseCode != HederaResponseCodes.SUCCESS) {
            	revert("TokenSwap NFT Transfer failed");
        	}
		}

		// send the lazy to the user
		if (amt == 0) return 0;
        responseCode = this.transferFrom(
            _lazyToken,
            _lazySCT,
            msg.sender,
            amt
        );

        emit TokenSwapEvent(
            msg.sender,
			_lazySCT,
            0,
			_lazyToken,
			amt,
			"$LAZY sent"
        );

        if (responseCode != HederaResponseCodes.SUCCESS) {
            revert("TokenSwap FT Transfer failed");
        }
    }

	function getNewSwapToken() external view returns (address token) {
		token = _swapToken;
	}

	function getLazySCT() external view returns (address sct) {
		sct = _lazySCT;
	}

	function getLazyToken() external view returns (address token) {
		token = _lazyToken;
	}

	/// @return paused unit of time for a claim.
    function getPauseStatus() external view returns (bool paused) {
    	paused = _paused;
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
        // throws error on failure
        receiverAddress.transfer(amount);

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