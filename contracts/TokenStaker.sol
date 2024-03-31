// SPDX-License-Identifier: MIT
pragma solidity >=0.8.12 <0.9.0;

/// @title Core Staking Module for NFTs
/// @author stowerling.eth / stowerling.hbar
/// @notice This smart contract handles the movement of NFTs between the user and other contracts
/// @dev hands off the FT handling to the thwe LazyGasStation contract
/// @dev requires FT for royalty handling currently

import { HederaResponseCodes } from "./HederaResponseCodes.sol";
import { HederaTokenService } from "./HederaTokenService.sol";
import { IHederaTokenService } from "./interfaces/IHederaTokenService.sol";

import { ILazyGasStation } from "./interfaces/ILazyGasStation.sol";
import { ILazyDelegateRegistry } from "./interfaces/ILazyDelegateRegistry.sol";

import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract TokenStaker is HederaTokenService {
	using SafeCast for uint256;
	using SafeCast for int256;

    enum TransferDirection {
        STAKING,
        WITHDRAWAL
    }

    address public lazyToken;
	ILazyGasStation public lazyGasStation;
	ILazyDelegateRegistry public lazyDelegateRegistry;
    uint256 private constant MAX_NFTS_PER_TX = 8;

	modifier refill() {
		if(IERC20(lazyToken).balanceOf(address(this)) < 20) {
			lazyGasStation.refillLazy(50);
		}
		_;
	}

    function initContracts(address _lazyToken, address _lazyGasStation, address _lazyDelegateRegistry) internal {
        lazyToken = _lazyToken;
		lazyGasStation = ILazyGasStation(_lazyGasStation);
		lazyDelegateRegistry = ILazyDelegateRegistry(_lazyDelegateRegistry);

        int256 response = HederaTokenService.associateToken(
            address(this),
            lazyToken
        );

        if (response != HederaResponseCodes.SUCCESS) {
            revert("AF INIT");
        }
    }

    //function to transfer NFTs
    function moveNFTs(
        TransferDirection _direction,
        address _collectionAddress,
        uint256[] memory _serials,
        address _transferInitiator,
		bool _delegate
    ) internal {
        require(_serials.length <= 8, "Serials>");
        address receiverAddress;
        address senderAddress;

        if (_direction == TransferDirection.STAKING) {
            receiverAddress = address(this);
            senderAddress = _transferInitiator;
        } else {
            receiverAddress = _transferInitiator;
            senderAddress = address(this);
        }

        // sized to a single move, expandable to up to 10 elements (untested)
        IHederaTokenService.TokenTransferList[]
            memory _transfers = new IHederaTokenService.TokenTransferList[](
                _serials.length + 1
            );
        //transfer lazy token
        _transfers[0].transfers = new IHederaTokenService.AccountAmount[](2);
        _transfers[0].token = lazyToken;

        IHederaTokenService.AccountAmount memory _sendAccountAmount;
        _sendAccountAmount.accountID = receiverAddress;
        _sendAccountAmount.amount = -1;
        _transfers[0].transfers[0] = _sendAccountAmount;

        IHederaTokenService.AccountAmount memory _recieveAccountAmount;
        _recieveAccountAmount.accountID = senderAddress;
        _recieveAccountAmount.amount = 1;
        _transfers[0].transfers[1] = _recieveAccountAmount;

		if(_delegate && _direction == TransferDirection.WITHDRAWAL) {
			// order matters, we can only do this BEFORE transfer as contract must hold the NFTs
			lazyDelegateRegistry.revokeDelegateNFT(_collectionAddress, _serials);
		}

        // transfer NFT
        for (uint256 i = 0; i < _serials.length; i++) {
            IHederaTokenService.NftTransfer memory _nftTransfer;
            _nftTransfer.senderAccountID = senderAddress;
            _nftTransfer.receiverAccountID = receiverAddress;
            if (_serials[i] == 0) {
                continue;
            }
            _transfers[i + 1].token = _collectionAddress;
            _transfers[i + 1]
                .nftTransfers = new IHederaTokenService.NftTransfer[](1);

            _nftTransfer.serialNumber = SafeCast.toInt64(int256(_serials[i]));
            _transfers[i + 1].nftTransfers[0] = _nftTransfer;
        }

        int256 response = HederaTokenService.cryptoTransfer(_transfers);

        if (response != HederaResponseCodes.SUCCESS) {
			// could be $LAZY or serials causing the issue. Check $LAZY balance of contract first
            revert("NFT tfer fail");
        }

		if(_delegate && _direction == TransferDirection.STAKING) {
			// order matters, we can only do this AFTER transfer as contract must hold the NFTs
			lazyDelegateRegistry.delegateNFT(senderAddress, _collectionAddress, _serials);
		}
    }

    /**
     * @dev associate token with hedera service
     * @param tokenId address to associate
     */
    function tokenAssociate(address tokenId) public {
        int256 response = HederaTokenService.associateToken(
            address(this),
            tokenId
        );

        if (!(response == SUCCESS || response == TOKEN_ALREADY_ASSOCIATED_TO_ACCOUNT)) {
            revert("AF");
        }
    }

    function batchTokenAssociate(address[] memory tokenIds) public {
        int256 response = HederaTokenService.associateTokens(
            address(this),
            tokenIds
        );

        if (response != HederaResponseCodes.SUCCESS) {
            revert("BAF");
        }
    }

	/**
	 * @dev associate a group of tokens one at a time to ensure alrady associated tokens are safely handled
	 * less gas efficient than batchTokenAssociate
	 * @param tokenIds array of token addresses to associate
	 */
	function safeBatchTokenAssociate(address[] memory tokenIds) public {
		uint256 tokenArrayLength = tokenIds.length;
		for(uint256 i = 0; i < tokenArrayLength;) {
			tokenAssociate(tokenIds[i]);
			unchecked {	++i; }
		}
	}

	/**
	 * @dev associate a group of tokens one at a time comparing to a list of already associated tokens
	 * less gas efficient than batchTokenAssociate but should be more efficient than safeBatchTokenAssociate
	 * lots of loop work here, so gas costs are high
	 * @param tokenIds array of token addresses to associate
	 * @param existingTokenIds array of token addresses already associated
	 */
	function noClashBatchTokenAssociate(address[] memory tokenIds, address[] memory existingTokenIds) public {
		uint256 tokenArrayLength = tokenIds.length;
		uint256 existingTokenArrayLength = existingTokenIds.length;
		for(uint256 i = 0; i < tokenArrayLength;) {
			bool clash = false;
			for(uint256 j = 0; j < existingTokenArrayLength;) {
				if(tokenIds[i] == existingTokenIds[j]) {
					clash = true;
					break;
				}
				unchecked {	++j; }
			}
			if(!clash) {
				tokenAssociate(tokenIds[i]);
			}
			unchecked {	++i; }
		}
	}

    function batchMoveNFTs(
        TransferDirection _direction,
        address _collectionAddress,
        uint256[] memory _serials,
        address _transferInitiator,
		bool _delegate
    ) internal refill() {
        // check the number of serials and send in batchs of 8
        for (
            uint256 outer = 0;
            outer < _serials.length;
            outer += MAX_NFTS_PER_TX
        ) {
            uint256 batchSize = (_serials.length - outer) >= MAX_NFTS_PER_TX
                ? MAX_NFTS_PER_TX
                : (_serials.length - outer);
            uint256[] memory serials = new uint256[](batchSize);
            for (
                uint256 inner = 0;
                ((outer + inner) < _serials.length) &&
                    (inner < MAX_NFTS_PER_TX);
                inner++
            ) {
                if (outer + inner < _serials.length) {
                    serials[inner] = _serials[outer + inner];
                }
            }
            moveNFTs(
                _direction,
                _collectionAddress,
                serials,
                _transferInitiator,
				_delegate
            );
        }
    }
}
