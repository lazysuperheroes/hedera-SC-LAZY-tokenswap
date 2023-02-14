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
	using EnumerableMap for EnumerableMap.UintToUintMap;

	address private _swapToken;
	address private _swapTokenTreasury;
	address private _lazyToken;
	address private _lazySCT;

	uint256 private _lazyPmtAmt;

	EnumerableMap.UintToUintMap private _serialToAmountMap;

	bool private _paused;

	event TokenSwapEvent(
        address indexed user,
        address indexed tokenBurnt,
		uint256 serial,
		uint256 amount,
		address indexed tokenEarnt,
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

		associateToken(address(this), _swapToken);
    }

	/// @param paused boolean to pause (true) or release (false)
	/// @return changed indicative of whether a change was made
	function updatePauseStatus(bool paused) external onlyOwner returns (bool changed) {
		changed = _paused == paused ? false : true;
		if (changed) {
			emit TokenSwapEvent(msg.sender, address(0), 0, 0, address(0), string.concat(paused ? "PAUSED @ " : "UNPAUSED @ ", Strings.toString(block.timestamp)));
		}
		_paused = paused;
	}

	function updateSerialBurnAmount(uint256[] calldata serials, uint256[] calldata amounts) external onlyOwner {
		require(serials.length == amounts.length, "Serials != amounts length");

		for(uint256 i = 0; i < serials.length; i++) {
			_serialToAmountMap.set(serials[i], amounts[i]);
		}	
	}

	function removeSerialsBurnAmount(uint256[] calldata serials) external onlyOwner {
		for(uint256 i = 0; i < serials.length; i++) {
			_serialToAmountMap.remove(serials[i]);
		}
	}

	function updateSCT(address sct) external onlyOwner {
		require(sct != address(0), "SCT cannot be zero address");
		_lazySCT = sct;
	}

	function updateLazyToken(address lazy) external onlyOwner {
		require(lazy != address(0), "Lazy cannot be zero address");
		_lazyToken = lazy;
	}

	function updateswapToken(address swapToken) external onlyOwner {
		require(swapToken != address(0), "B2EToken cannot be zero address");
		_swapToken = swapToken;
	}

	/// @param serials array of serial numbers of the NFTs to transfer
    function burnNFTToEarn(
        uint256[] calldata serials
    ) external payable returns (uint amt) {
        require(serials.length <= type(uint8).max, "Too many serials");
		require(!_paused, "Contract is paused");
		int responseCode;

		// check if user has associated token
		if(IERC721(_lazyToken).balanceOf(msg.sender) == 0) associateToken(msg.sender, _lazyToken);

		for(uint256 i = 0; i < serials.length; i += 10) {
			// outer loop to group transfers efficiently in bundles of 10
			uint arraySze = Math.min(serials.length - i, 10);
			address[] memory receievers = new address[](arraySze);
			address[] memory senders = new address[](arraySze);
			int64[] memory serialsToSend = new int64[](arraySze);
			// inner loop to group transfers efficiently in bundles of 10
			for (uint8 inner = 0; (inner < 10) && (i + inner < serials.length); inner++	) {
				// check the NFT is burn eligible
				(bool found, uint amtToSend) = _serialToAmountMap.tryGet(serials[i + inner]);
				if (found) {
					/*
					*	Removing the check if the user owns the serial as each check spawns
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
					// if (IERC721(_swapToken).ownerOf(serials[i + inner]) == msg.sender){
						// calculate amount to send
						amt += amtToSend;

						// update the record
						_serialToAmountMap.remove(serials[i  + inner]);

						// add to lists to transfer it to treasury	
						receievers[inner] = _swapTokenTreasury;
						senders[inner] = msg.sender;
						serialsToSend[inner] = SafeCast.toInt64(SafeCast.toInt256(serials[i  + inner]));

						// emit the event
						emit TokenSwapEvent(
							msg.sender,
							_swapToken,
							serials[i + inner],
							amtToSend,
							_lazyToken,
							"Burn2Earn"
						);
					// }
				}
			}
			// transfer the NFTs
			responseCode = transferNFTs(_swapToken, senders, receievers, serialsToSend);
			if (responseCode != HederaResponseCodes.SUCCESS) {
            	revert("B2E NFT Transfer failed");
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
			address(0),
			0,
            amt,
			_lazyToken,
			"$LAZY sent"
        );

        if (responseCode != HederaResponseCodes.SUCCESS) {
            revert("B2E FT Transfer failed");
        }
    }

	function getEarnForSerials(uint256[] calldata serials) external view returns (uint256 amount) {
		for(uint256 i = 0; i < serials.length; i++) {
			bool found;
			uint256 amt;
			(found, amt) = _serialToAmountMap.tryGet(serials[i]);
			if (found) amount += amt;
		}
	}

	function getSerialPaymentAmounts(uint batch, uint offset) external view returns (uint256[] memory serials, uint256[] memory amounts) {
		require(offset < (_serialToAmountMap.length() - batch), "Offset out of range");
		uint size = Math.min(batch, _serialToAmountMap.length());
		
		serials = new uint256[](size);
		amounts = new uint256[](size);

		for(uint i = 0; i < size; i++) {
			(serials[i], amounts[i]) = _serialToAmountMap.at(i + offset);
		}
	}

	function getswapToken() external view returns (address token) {
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
			0,
			address(0),
			"Hbar Transfer Complete"
		);
    }

    receive() external payable {
		emit TokenSwapEvent(
			msg.sender,
			address(0),
			msg.value,
			0,
			address(0),
			"Hbar Received by Contract"
		);
    }

    fallback() external payable {
		emit TokenSwapEvent(
			msg.sender,
			address(0),
			msg.value,
			0,
			address(0),
			"Fallback Called"
		);
    }
}