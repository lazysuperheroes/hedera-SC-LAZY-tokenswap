// SPDX-License-Identifier: MIT
pragma solidity >=0.8.12 <0.9.0;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import { EnumerableSet } from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import { Address } from "@openzeppelin/contracts/utils/Address.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/security/ReentrancyGuard.sol";

import { HederaResponseCodes } from "./HederaResponseCodes.sol";
import { HederaTokenService } from "./HederaTokenService.sol";

import { ILazyGasStation } from "./interfaces/ILazyGasStation.sol";
import { IRoles } from "./interfaces/IRoles.sol";
import { IBurnableHTS } from "./interfaces/IBurnableHTS.sol";

contract LazyGasStation is HederaTokenService, ILazyGasStation, IRoles, ReentrancyGuard {
	using SafeCast for uint256;
	using SafeCast for int256;
	using EnumerableSet for EnumerableSet.AddressSet;
	using Address for address;

	event GasStationRefillEvent(
		address indexed _callingContract,
		uint256 _amount
	);

	event GasStationFunding(
		address indexed _callingContract,
		address indexed _user,
		uint256 _amount,
		uint256 _burnPercentage,
		bool _fromUser
	);

	event GasStationAccessControlEvent(
		address indexed _executor,
		address indexed _address,
		bool _added,
		Role _role
	);

	EnumerableSet.AddressSet private admins;
	EnumerableSet.AddressSet private authorizers;
	EnumerableSet.AddressSet private contractUsers;

	address public lazyToken;
	address public lazySCT;

	constructor(
		address _lazyToken,
		address _lazySCT
	) {
		lazyToken = _lazyToken;
		lazySCT = _lazySCT;

		int256 response = HederaTokenService.associateToken(
			address(this),
			lazyToken
		);

		if (response != HederaResponseCodes.SUCCESS) {
			revert("Associate Failed");
		}

		admins.add(msg.sender);
	}

	modifier onlyAdmin() {
		if(!admins.contains(msg.sender)) revert PermissionDenied(msg.sender, Role.Admin);
		_;
	}

	modifier onlyAuthorizer() {
		if(!authorizers.contains(msg.sender)) revert PermissionDenied(msg.sender, Role.GasStationAuthorizer);
		_;
	}

	modifier onlyContractUser() {
		if(!contractUsers.contains(msg.sender)) revert PermissionDenied(msg.sender, Role.GasStationContractUser);
		_;
	}

	modifier onlyAdminOrAuthorizer() {
		if(!(admins.contains(msg.sender) || authorizers.contains(msg.sender)))
			revert PermissionDenied(msg.sender, Role.AdminOrCreator);
		_;
	}

	function refillLazy(
		uint256 _amount
	) external onlyContractUser nonReentrant {
		require(IERC20(lazyToken).balanceOf(address(this)) >= _amount, "$LAZY Gas Station Empty");
		require(_amount > 0, "Invalid amount");

		bool result = IERC20(lazyToken).transfer(msg.sender, _amount);
		require(result, "Transfer failed");

		emit GasStationRefillEvent(msg.sender, _amount);
	}

	function payoutLazy(
		address _user,
		uint256 _amount,
		uint256 _burnPercentage
	) external onlyContractUser nonReentrant returns (uint256 _payoutAmount) {
		require(_amount > 0, "Invalid amount");
		require(_burnPercentage <= 100, "Invalid burn percentage");

		uint256 burnAmt = (_amount * _burnPercentage) / 100;

		bool result;
		if (burnAmt > 0) {
			int256 responseCode = IBurnableHTS(lazySCT).burn(
				lazyToken,
				burnAmt.toUint32()
			);

			if (responseCode != HederaResponseCodes.SUCCESS) {
				revert("burning $LAZY - fail");
			}

			// pay out the remainder to the user
			uint256 remainder = _amount - burnAmt;
			if (remainder > 0) {
				result = IERC20(lazyToken).transfer(
					_user,
					remainder
				);
				require(result, "LGS payout (net) fail");
			}
			_payoutAmount = remainder;
		}
		else {
			result = IERC20(lazyToken).transfer(
				_user,
				_amount
			);
			require(result, "LAZY payout fail");
			_payoutAmount = _amount;
		}

		emit GasStationFunding(msg.sender, _user, _amount, _burnPercentage, false);
	}

	function drawLazyFrom(
		address _user,
		uint256 _amount,
		uint256 _burnPercentage
	) external onlyContractUser {
		drawLazyFromPayTo(_user, _amount, _burnPercentage, address(this));
	}

	function drawLazyFromPayTo(
		address _user,
		uint256 _amount,
		uint256 _burnPercentage,
		address _payTo
	) public onlyContractUser nonReentrant {
		require(
            IERC20(lazyToken).allowance(_user, address(this)) >= _amount,
            "Insufficient $LAZY allowance"
        );
		require(_amount > 0, "Invalid amount");
		require(_burnPercentage <= 100, "Invalid burn percentage");
		require(_payTo != address(0), "Invalid address");

		uint256 burnAmt = (_amount * _burnPercentage) / 100;

		// If there is any to burn will need to transfer to this contract first then send balanmce on
		bool result;
		if (burnAmt > 0) {
			result = IERC20(lazyToken).transferFrom(
				_user,
				address(this),
				_amount
			);
			require(result, "2LGS Tfr fail");
			int256 responseCode = IBurnableHTS(lazySCT).burn(
                lazyToken,
                burnAmt.toUint32()
            );

            if (responseCode != HederaResponseCodes.SUCCESS) {
                revert("burning $LAZY - fail");
            }

			// send the remainder to the mission factory
			uint256 remainder = _amount - burnAmt;
			if (remainder > 0 && _payTo != address(this)) {
				result = IERC20(lazyToken).transferFrom(
					address(this),
					_payTo,
					remainder
				);
				require(result, "LGS PayTo fail");
			}
		}
		else {
			result = IERC20(lazyToken).transferFrom(
				_user,
				_payTo,
				_amount
			);
			require(result, "LAZY Tfr fail");
		}

		emit GasStationFunding(msg.sender, _user, _amount, _burnPercentage, true);
	}

	function addAdmin(
		address _admin
	) external onlyAdmin returns (bool _added){
		emit GasStationAccessControlEvent(msg.sender, _admin, true, Role.Admin);
		return admins.add(_admin);
	}

	function removeAdmin(
		address _admin
	) external onlyAdmin returns (bool _removed){
		require(admins.length() > 1, "Last Admin");
		emit GasStationAccessControlEvent(msg.sender, _admin, false, Role.Admin);
		return admins.remove(_admin);
	}

	function addAuthorizer(
		address _authorized
	) external onlyAdmin returns (bool _added){
		emit GasStationAccessControlEvent(msg.sender, _authorized, true, Role.GasStationAuthorizer);
		return authorizers.add(_authorized);
	}

	function removeAuthorizer(
		address _authorized
	) external onlyAdmin returns (bool _removed){
		emit GasStationAccessControlEvent(msg.sender, _authorized, false, Role.GasStationAuthorizer);
		return authorizers.remove(_authorized);
	}

	function addContractUser(
		address _deployer
	) external onlyAdminOrAuthorizer returns (bool _added){
		require(_deployer != address(0), "Invalid address");
		require(_deployer.isContract(), "EOA Address");
		emit GasStationAccessControlEvent(msg.sender, _deployer, true, Role.GasStationContractUser);
		return contractUsers.add(_deployer);
	}

	function removeContractUser(
		address _deployer
	) external onlyAdminOrAuthorizer returns (bool _removed){
		emit GasStationAccessControlEvent(msg.sender, _deployer, false, Role.GasStationContractUser);
		return contractUsers.remove(_deployer);
	}

	function getAdmins() external view returns (address[] memory _admins) {
		return admins.values();
	}

	function getAuthorizers() external view returns (address[] memory _authorizers) {
		return authorizers.values();
	}

	function getContractUsers() external view returns (address[] memory _contractUsers) {
		return contractUsers.values();
	}

	function isAdmin(address _admin) external view returns (bool _isAdmin) {
		return admins.contains(_admin);
	}

	function isAuthorizer(address _authorizer) external view returns (bool _isAuthorizer) {
		return authorizers.contains(_authorizer);
	}

	function isContractUser(address _contractUser) external view returns (bool _isContractUser) {
		return contractUsers.contains(_contractUser);
	}

    function transferHbar(address payable receiverAddress, uint256 amount)
        external
        onlyAdmin()
    {
		if (receiverAddress == address(0) || amount == 0) {
			revert("Invalid address or amount");
		}
		Address.sendValue(receiverAddress, amount);
    }

	function retrieveLazy(
		address _receiver,
		uint256 _amount
	) external onlyAdmin() {
		if (_receiver == address(0) || _amount == 0) {
			revert("Invalid address or amount");
		}

		IERC20(lazyToken).transfer(_receiver, _amount);
	}
}