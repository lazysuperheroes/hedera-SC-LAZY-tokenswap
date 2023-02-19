const {
	Client,
	AccountId,
	PrivateKey,
	ContractCreateFlow,
	ContractFunctionParameters,
	ContractCallQuery,
	Hbar,
	ContractExecuteTransaction,
	AccountCreateTransaction,
	TokenCreateTransaction,
	TokenType,
	TokenSupplyType,
	HbarUnit,
	AccountInfoQuery,
	// eslint-disable-next-line no-unused-vars
	TransactionReceipt,
	TransferTransaction,
	// eslint-disable-next-line no-unused-vars
	TokenId,
	ContractInfoQuery,
	TokenMintTransaction,
	// eslint-disable-next-line no-unused-vars
	ContractId,
	TokenAssociateTransaction,
	AccountAllowanceApproveTransaction,
	NftId,
} = require('@hashgraph/sdk');
const fs = require('fs');
const Web3 = require('web3');
const web3 = new Web3();
const { expect } = require('chai');
const { describe, it, after } = require('mocha');

require('dotenv').config();

// Get operator from .env file
const operatorKey = PrivateKey.fromString(process.env.PRIVATE_KEY);
const operatorId = AccountId.fromString(process.env.ACCOUNT_ID);
const contractName = process.env.CONTRACT_NAME ?? null;
const env = process.env.ENVIRONMENT ?? null;
const TOKEN_DECIMAL = 1;

const addressRegex = /(\d+\.\d+\.[1-9]\d+)/i;

// reused variable
let contractId;
let contractAddress;
let abi;
let alicePK, aliceId;
let bobPK, bobId;
let ftTokenId, newNftTokenId, legacyCollectionNFT_1_TokenId, legacyCollectionNFT_2_TokenId, legacyCollectionNFT_3_TokenId;
let client;

describe('Deployment: ', function() {
	it('Should deploy the contract and setup conditions', async function() {
		if (contractName === undefined || contractName == null) {
			console.log('Environment required, please specify CONTRACT_NAME for ABI in the .env file');
			process.exit(1);
		}
		if (operatorKey === undefined || operatorKey == null || operatorId === undefined || operatorId == null) {
			console.log('Environment required, please specify PRIVATE_KEY & ACCOUNT_ID in the .env file');
			process.exit(1);
		}

		console.log('\n-Using ENIVRONMENT:', env);

		if (env.toUpperCase() == 'TEST') {
			client = Client.forTestnet();
			console.log('testing in *TESTNET*');
		}
		else if (env.toUpperCase() == 'MAIN') {
			client = Client.forMainnet();
			console.log('testing in *MAINNET*');
		}
		else {
			console.log('ERROR: Must specify either MAIN or TEST as environment in .env file');
			return;
		}

		client.setOperator(operatorId, operatorKey);

		console.log('\n-Testing:', contractName);
		// create Alice account
		alicePK = PrivateKey.generateED25519();
		aliceId = await accountCreator(alicePK, 500);
		console.log('Alice account ID:', aliceId.toString(), '\nkey:', alicePK.toString());

		client.setOperator(aliceId, alicePK);
		// mint an FT to act as $LAZY
		await mintFT(aliceId, alicePK);
		// mint three legacy NFT collections from Alice account of 50 serials
		// mint one new collection of 150 serials to swap into
		await mintNFTs();

		client.setOperator(operatorId, operatorKey);
		// associate FT/NFT to operator
		let result = await associateTokensToAccount(operatorId, [ftTokenId]);
		expect(result).to.be.equal('SUCCESS');
		result = await associateTokensToAccount(operatorId, [newNftTokenId, legacyCollectionNFT_1_TokenId, legacyCollectionNFT_2_TokenId, legacyCollectionNFT_3_TokenId]);
		expect(result).to.be.equal('SUCCESS');

		// deploy the contract
		console.log('\n-Using Operator:', operatorId.toString());

		const json = JSON.parse(fs.readFileSync(`./artifacts/contracts/${contractName}.sol/${contractName}.json`));

		// import ABI
		abi = json.abi;

		const contractBytecode = json.bytecode;
		const gasLimit = 1000000;

		console.log('\n- Deploying contract...', contractName, '\n\tgas@', gasLimit);

		await contractDeployFcn(contractBytecode, gasLimit);

		console.log(`Contract created with ID: ${contractId} / ${contractAddress}`);

		expect(contractId.toString().match(addressRegex).length == 2).to.be.true;

		console.log('\n-Testing:', contractName);

		// send 1 hbar to the contract.
		await hbarTransferFcn(operatorId, operatorKey, contractId, 5);

		// set allowance for the contract for the FT
		client.setOperator(aliceId, alicePK);
		await setFungibleAllowance(contractId, aliceId, 50000);

		// create Bob account
		client.setOperator(operatorId, operatorKey);
		bobPK = PrivateKey.generateED25519();
		bobId = await accountCreator(bobPK, 200);
		console.log('Bob account ID:', bobId.toString(), '\nkey:', bobPK.toString());

		// associate the nft token for Bob
		// do not associate FT to see if contract will auto associate as planned
		// do not associate new collection NFT to see if contract will auto associate as planned
		client.setOperator(bobId, bobPK);
		result = await associateTokensToAccount(bobId, [legacyCollectionNFT_1_TokenId, legacyCollectionNFT_2_TokenId, legacyCollectionNFT_3_TokenId]);
		expect(result).to.be.equal('SUCCESS');

		// send 12 NFTs to Bob
		client.setOperator(aliceId, alicePK);
		await sendNFTs(bobId, aliceId, generateSerials(1, 12), legacyCollectionNFT_1_TokenId);
		await sendNFTs(bobId, aliceId, generateSerials(13, 24), legacyCollectionNFT_2_TokenId);
		await sendNFTs(bobId, aliceId, generateSerials(7, 18), legacyCollectionNFT_3_TokenId);
		// send 25 NFTs to Operator
		await sendNFTs(operatorId, aliceId, generateSerials(26, 50), legacyCollectionNFT_1_TokenId);
		await sendNFTs(operatorId, aliceId, generateSerials(26, 50), legacyCollectionNFT_2_TokenId);
		await sendNFTs(operatorId, aliceId, generateSerials(26, 50), legacyCollectionNFT_3_TokenId);

		// sent the new NFTs to the contract
		await sendNFTs(contractId, aliceId, generateSerials(1, 150), newNftTokenId);

		await sleep(2000);

		// check Alice NFT balance is 64
		const [aliceLazyBal, , aliceNewNFTBalance, aliceLegacy1Bal, aliceLegacy2Bal, aliceLegacy3Bal] = await getAccountBalance(aliceId);
		expect(aliceNewNFTBalance).to.be.equal(0);
		expect(aliceLegacy1Bal).to.be.equal(13);
		expect(aliceLegacy2Bal).to.be.equal(13);
		expect(aliceLegacy3Bal).to.be.equal(13);
		expect(aliceLazyBal).to.be.equal(100000);
	});
});

describe('Operator sets up the claim amount', function() {
	it('Should setup the swaps', async function() {
		// set claim amount
		client.setOperator(operatorId, operatorKey);

		// set claim $LAZY amount
		let [result] = await useSetterUint256('updateClaimAmount', 100);
		expect(result).to.be.equal('SUCCESS');

		const newSerialList = [];
		const swapHashList = [];
		for (let i = 1; i <= 150; i++) {
			newSerialList.push(i);
			let tokenForConfig, serial;
			if (i <= 50) {
				tokenForConfig = legacyCollectionNFT_1_TokenId;
				serial = i;
			}
			else if (i <= 100) {
				tokenForConfig = legacyCollectionNFT_2_TokenId;
				serial = i - 50;
			}
			else {
				tokenForConfig = legacyCollectionNFT_3_TokenId;
				serial = i - 100;
			}
			swapHashList.push(web3.utils.soliditySha3(
				{ t: 'address', v: tokenForConfig.toSolidityAddress() },
				{ t: 'uint256', v: serial },
			));
		}
		[result] = await useSetterConfig('updateSwapConfig', newSerialList.slice(0, 50), swapHashList.slice(0, 50));
		expect(result).to.be.equal('SUCCESS');
		[result] = await useSetterConfig('updateSwapConfig', newSerialList.slice(50, 100), swapHashList.slice(50, 100));
		expect(result).to.be.equal('SUCCESS');
		[result] = await useSetterConfig('updateSwapConfig', newSerialList.slice(100), swapHashList.slice(100));
		expect(result).to.be.equal('SUCCESS');
	});

	it('Should unpause the contract', async function() {
		// unpause
		client.setOperator(operatorId, operatorKey);
		const result = await useSetterBool('updatePauseStatus', false);
		expect(result).to.be.equal('SUCCESS');
	});
});

describe('Access Checks: ', function() {
	it('Alice cant call sensitive methods', async function() {
		client.setOperator(aliceId, alicePK);
		let errorCount = 0;
		// update FT SCT
		try {
			await useSetterAddress('updateSCT', aliceId);
		}
		catch (err) {
			errorCount++;
		}
		// update FT
		try {
			await useSetterAddress('updateLazyToken', ftTokenId);
		}
		catch (err) {
			errorCount++;
		}
		// update claim NFT
		try {
			await useSetterAddress('updateSwapToken', newNftTokenId);
		}
		catch (err) {
			errorCount++;
		}
		// update pause
		try {
			await useSetterBool('updatePauseStatus', false);
		}
		catch (err) {
			errorCount++;
		}
		// add config
		try {
			await useSetterConfig('updateSwapConfig', [1], [web3.utils.soliditySha3(
				{ t: 'address', v: newNftTokenId.toSolidityAddress() },
				{ t: 'uint256', v: 99999 },
			)]);
		}
		catch (err) {
			errorCount++;
		}
		// remove config
		try {
			await useSetterBytes32Array('removeSwapConfig', [web3.utils.soliditySha3(
				{ t: 'address', v: newNftTokenId.toSolidityAddress() },
				{ t: 'uint256', v: 99999 },
			)]);
		}
		catch (err) {
			errorCount++;
		}
		// transfer Hbar
		try {
			await transferHbarFromContract(aliceId, 1, HbarUnit.Tinybar);
		}
		catch (err) {
			errorCount++;
		}
		expect(errorCount).to.be.equal(7);
	});

	it('Alice can call regular methods', async function() {
		client.setOperator(aliceId, alicePK);
		let errorCount = 0;
		try {
			const sct = await getSetting('getLazySCT', 'sct');
			expect(AccountId.fromSolidityAddress(sct).toString() == aliceId.toString()).to.be.true;
		}
		catch (err) {
			errorCount++;
			console.log(err);
		}
		try {
			const lazy = await getSetting('getLazyToken', 'token');
			expect(TokenId.fromSolidityAddress(lazy).toString() == ftTokenId.toString()).to.be.true;
		}
		catch (err) {
			errorCount++;
			console.log(err);
		}
		try {
			const nft = await getSetting('getNewSwapToken', 'token');
			expect(TokenId.fromSolidityAddress(nft).toString() == newNftTokenId.toString()).to.be.true;
		}
		catch (err) {
			errorCount++;
			console.log(err);
		}
		try {
			const pause = await getSetting('getPauseStatus', 'paused');
			expect(pause).to.be.false;
		}
		catch (err) {
			errorCount++;
			console.log(err);
		}
		try {
			const newSerialList = await getSerials([legacyCollectionNFT_1_TokenId, legacyCollectionNFT_2_TokenId], [1, 1]);
			// console.log('newSerialList: ', newSerialList);
			expect(newSerialList.length == 2).to.be.true;
		}
		catch (err) {
			errorCount++;
			console.log(err);
		}
		expect(errorCount).to.be.equal(0);
	});
});

describe('Interaction: ', function() {
	it('Bob can Swap', async function() {
		client.setOperator(bobId, bobPK);
		let [result, amt] = await swapTokens([legacyCollectionNFT_1_TokenId.toSolidityAddress()], [1], 1_850_000);
		expect(result).to.be.equal('SUCCESS');
		expect(amt).to.be.equal(100);
		await sleep(2000);
		// check Lazy Balance is now 100
		let [bobLazyBal, , bobNFTBalance, bobLegacy1Bal, bobLegacy2Bal, bobLegacy3Bal] = await getAccountBalance(bobId);
		// console.log('Bob Lazy Balance', bobLazyBal, bobNFTBalance, bobLegacy1Bal, bobLegacy2Bal, bobLegacy3Bal);
		expect(bobLazyBal).to.be.equal(100);
		expect(bobNFTBalance).to.be.equal(1);
		expect(bobLegacy1Bal).to.be.equal(11);
		expect(bobLegacy2Bal).to.be.equal(12);
		expect(bobLegacy3Bal).to.be.equal(12);

		let [aliceLazyBal, , aliceNFTBalance, aliceLegacy1Bal, aliceLegacy2Bal, aliceLegacy3Bal] = await getAccountBalance(aliceId);
		// console.log('Alice Lazy Balance', aliceLazyBal, aliceNFTBalance, aliceLegacy1Bal, aliceLegacy2Bal, aliceLegacy3Bal);
		expect(aliceLazyBal).to.be.equal(100000 - bobLazyBal);
		expect(aliceLegacy1Bal).to.be.equal(14);
		expect(aliceLegacy2Bal).to.be.equal(13);
		expect(aliceLegacy3Bal).to.be.equal(13);

		// check contract balance
		let [, contractNFTBalance] = await getContractBalance(contractId);
		expect(contractNFTBalance).to.be.equal(149);

		// now burn 11, 12, 12 NFTs of legacy 1, 2, 3
		const tokenAddressList = [];
		const serialList = [];
		for (let i = 2; i <= 12; i++) {
			tokenAddressList.push(legacyCollectionNFT_1_TokenId.toSolidityAddress());
			serialList.push(i);
		}
		for (let i = 13; i <= 24; i++) {
			tokenAddressList.push(legacyCollectionNFT_2_TokenId.toSolidityAddress());
			serialList.push(i);
		}
		for (let i = 7; i <= 18; i++) {
			tokenAddressList.push(legacyCollectionNFT_3_TokenId.toSolidityAddress());
			serialList.push(i);
		}

		[result, amt] = await swapTokens(tokenAddressList, serialList);
		expect(result).to.be.equal('SUCCESS');
		expect(amt).to.be.equal(3500);
		await sleep(2000);
		[bobLazyBal, , bobNFTBalance, bobLegacy1Bal, bobLegacy2Bal, bobLegacy3Bal] = await getAccountBalance(bobId);
		// console.log('Bob Lazy Balance', bobLazyBal, bobNFTBalance, bobLegacy1Bal, bobLegacy2Bal, bobLegacy3Bal);
		expect(bobLazyBal).to.be.equal(3600);
		expect(bobNFTBalance).to.be.equal(36);
		expect(bobLegacy1Bal).to.be.equal(0);
		expect(bobLegacy2Bal).to.be.equal(0);
		expect(bobLegacy3Bal).to.be.equal(0);

		// eslint-disable-next-line no-unused-vars
		[aliceLazyBal, , aliceNFTBalance, aliceLegacy1Bal, aliceLegacy2Bal, aliceLegacy3Bal] = await getAccountBalance(aliceId);
		// console.log('Alice Lazy Balance', aliceLazyBal, aliceNFTBalance, aliceLegacy1Bal, aliceLegacy2Bal, aliceLegacy3Bal);
		expect(aliceLazyBal).to.be.equal(100000 - bobLazyBal);
		expect(aliceLegacy1Bal).to.be.equal(25);
		expect(aliceLegacy2Bal).to.be.equal(25);
		expect(aliceLegacy3Bal).to.be.equal(25);

		[, contractNFTBalance] = await getContractBalance(contractId);
		expect(contractNFTBalance).to.be.equal(114);

	});

	it('Operator can Swap', async function() {
		client.setOperator(operatorId, operatorKey);
		let [result, amt] = await swapTokens([legacyCollectionNFT_1_TokenId.toSolidityAddress()], [26], 1_850_000);
		expect(result).to.be.equal('SUCCESS');
		expect(amt).to.be.equal(100);
		await sleep(3000);
		// check Lazy Balance is now 10
		let [opLazyBal, , opNFTBalance, opLegacy1Bal, opLegacy2Bal, opLegacy3Bal] = await getAccountBalance(operatorId);
		// console.log('Operator Lazy Balance', opLazyBal, opNFTBalance, opLegacy1Bal, opLegacy2Bal, opLegacy3Bal);
		expect(opLazyBal).to.be.equal(100);
		expect(opNFTBalance).to.be.equal(1);
		expect(opLegacy1Bal).to.be.equal(24);
		expect(opLegacy2Bal).to.be.equal(25);
		expect(opLegacy3Bal).to.be.equal(25);

		let [aliceLazyBal, , , aliceLegacy1Bal, aliceLegacy2Bal, aliceLegacy3Bal] = await getAccountBalance(aliceId);
		// console.log('Alice Lazy Balance', aliceLazyBal, aliceNFTBalance, aliceLegacy1Bal, aliceLegacy2Bal, aliceLegacy3Bal);
		expect(aliceLazyBal).to.be.equal(100000 - 3600 - opLazyBal);
		expect(aliceLegacy1Bal).to.be.equal(26);
		expect(aliceLegacy2Bal).to.be.equal(25);
		expect(aliceLegacy3Bal).to.be.equal(25);

		let [, contractNFTBalance] = await getContractBalance(contractId);
		expect(contractNFTBalance).to.be.equal(113);

		// now burn 24, 25, 25 NFTs of legacy 1, 2, 3
		const tokenAddressList = [];
		const serialList = [];
		for (let i = 27; i <= 50; i++) {
			tokenAddressList.push(legacyCollectionNFT_1_TokenId.toSolidityAddress());
			serialList.push(i);
		}
		for (let i = 26; i <= 50; i++) {
			tokenAddressList.push(legacyCollectionNFT_2_TokenId.toSolidityAddress());
			serialList.push(i);
		}
		for (let i = 26; i <= 50; i++) {
			tokenAddressList.push(legacyCollectionNFT_3_TokenId.toSolidityAddress());
			serialList.push(i);
		}

		[result, amt] = await swapTokens(tokenAddressList, serialList);
		expect(result).to.be.equal('SUCCESS');
		expect(amt).to.be.equal(7400);
		await sleep(2000);
		[opLazyBal, , opNFTBalance, opLegacy1Bal, opLegacy2Bal, opLegacy3Bal] = await getAccountBalance(operatorId);
		// console.log('Operator Lazy Balance', opLazyBal, opNFTBalance, opLegacy1Bal, opLegacy2Bal, opLegacy3Bal);
		expect(opLazyBal).to.be.equal(7500);
		expect(opNFTBalance).to.be.equal(75);
		expect(opLegacy1Bal).to.be.equal(0);
		expect(opLegacy2Bal).to.be.equal(0);
		expect(opLegacy3Bal).to.be.equal(0);

		[aliceLazyBal, , , aliceLegacy1Bal, aliceLegacy2Bal, aliceLegacy3Bal] = await getAccountBalance(aliceId);
		// console.log('Alice Lazy Balance', aliceLazyBal, aliceNFTBalance, aliceLegacy1Bal, aliceLegacy2Bal, aliceLegacy3Bal);
		expect(aliceLazyBal).to.be.equal(100000 - 3600 - opLazyBal);
		expect(aliceLegacy1Bal).to.be.equal(50);
		expect(aliceLegacy2Bal).to.be.equal(50);
		expect(aliceLegacy3Bal).to.be.equal(50);

		[, contractNFTBalance] = await getContractBalance(contractId);
		expect(contractNFTBalance).to.be.equal(39);
	});

	after('Retrieve any hbar spent', async function() {
		client.setOperator(operatorId, operatorKey);
		const [, aliceHbarBal] = await getAccountBalance(aliceId);
		let result = await hbarTransferFcn(aliceId, alicePK, operatorId, aliceHbarBal.toBigNumber().minus(0.01));
		console.log('Clean-up -> Retrieve hbar from Alice');
		expect(result).to.be.equal('SUCCESS');


		const [, bobHbarBal] = await getAccountBalance(bobId);
		result = await hbarTransferFcn(bobId, bobPK, operatorId, bobHbarBal.toBigNumber().minus(0.01));
		console.log('Clean-up -> Retrieve hbar from Bob');
		expect(result).to.be.equal('SUCCESS');

		client.setOperator(operatorId, operatorKey);
		let [contractHbarBal] = await getContractBalance(contractId);
		result = await transferHbarFromContract(operatorId, Number(contractHbarBal.toTinybars()), HbarUnit.Tinybar);
		console.log('Clean-up -> Retrieve hbar from Contract');
		[contractHbarBal] = await getContractBalance(contractId);
		console.log('Contract ending hbar balance:', contractHbarBal.toString());
		expect(result).to.be.equal('SUCCESS');
	});
});

/**
 * @param {AccountId} acct
 * @param {PrivateKey} key
 */
async function mintFT(acct, key) {
	const tokenCreateTx = new TokenCreateTransaction()
		.setTokenName('B2E_FT' + acct.toString())
		.setTokenSymbol('B2E_FT')
		.setTokenType(TokenType.FungibleCommon)
		.setDecimals(TOKEN_DECIMAL)
		.setInitialSupply(100000)
		.setTreasuryAccountId(acct)
		.setSupplyKey(key)
		.freezeWith(client);

	const tokenCreateSubmit = await tokenCreateTx.execute(client);
	const tokenCreateRx = await tokenCreateSubmit.getReceipt(client);
	ftTokenId = tokenCreateRx.tokenId;
	console.log('FT Minted:', ftTokenId.toString());
}

/**
 * Generate a list of serials from start to end
 * @param {Number} start
 * @param {Number} end
 * @returns {Number[]}
 */
function generateSerials(start, end) {
	const serials = [];
	for (let i = start; i <= end; i++) {
		serials.push(i);
	}
	return serials;
}

/**
 * Helper function to send serial 1 of the minted NFT to Alic for testing
 * @param {AccountId} receiverId
 * @param {AccountId} senderId
 * @param {Number[]} serials
 * @param {TokenId} token
*/
async function sendNFTs(receiverId, senderId, serials, tokenToUse) {
	for (let outer = 0; outer < serials.length; outer += 10) {
		const transferTx = await new TransferTransaction();
		for (let inner = 0; (inner < 10 && (inner + outer) < serials.length); inner++) {
			const nft = new NftId(tokenToUse, serials[inner + outer]);
			// console.log('Sending NFT:', nft.toString(), 'to', receiverId.toString(), 'from', senderId.toString());
			transferTx.addNftTransfer(nft, senderId, receiverId);
		}

		transferTx.setTransactionMemo('NFBFTknSwp test NFT transfer')
			.freezeWith(client);

		// eslint-disable-next-line no-unused-vars
		const response = await transferTx.execute(client);
		// const receipt = await response.getReceipt(client);

		// console.log('NFT Transfer Result:', receipt.status.toString());
	}
}


/**
 * Method to encapsulate the staking method to send to graveyard
 * @param {string[]} tokenAddresses in solidity format
 * @param {Number[]} serials serials
 * @param {Number} gasBoost gas boost to add to the gas limit
 * @returns {string} 'SUCCESS' if it worked
 */
async function swapTokens(tokenAddresses, serials, gasBoost = 0) {
	// console.log('Swapping tokens:', tokenAddresses, serials, 'gasBoost:', gasBoost);
	const gasLim = 400_000 + ((serials.length - (serials.length % 5)) / 5 * 300_000) + gasBoost;
	// console.log('Gas Limit:', gasLim);

	const params = new ContractFunctionParameters()
		.addAddressArray(tokenAddresses)
		.addUint256Array(serials);
	const [stakingRx, contractResults] = await contractExecuteFcn(contractId, gasLim, 'swapNFTs', params);
	return [stakingRx.status.toString(), Number(contractResults['amt'])];
}

/**
 * Helper to setup the allowances
 * @param {AccountId} spenderAcct the account to set allowance for
 * @param {AccountId} ownerAcct the account to set allowance for
 * @param {*} amount amount of allowance to set
 */
async function setFungibleAllowance(spenderAcct, ownerAcct, amount) {
	const ctrcttAsAccount = AccountId.fromString(spenderAcct.toString());
	// console.log('Set approval\nToken:', tokenId.toString());
	// console.log('Spender:', spenderAcct.toString(), ctrcttAsAccount.toString());
	// console.log('Owner:', ownerAcct.toString(), aliceId.toString());
	const transaction = new AccountAllowanceApproveTransaction()
		.approveTokenAllowance(ftTokenId, ownerAcct, ctrcttAsAccount, amount)
		.freezeWith(client);

	const txResponse = await transaction.execute(client);
	const receipt = await txResponse.getReceipt(client);
	return receipt.status.toString();
}

/**
 * Helper function to deploy the contract
 * @param {string} bytecode bytecode from compiled SOL file
 * @param {number} gasLim gas limit as a number
 */
async function contractDeployFcn(bytecode, gasLim) {
	const contractCreateTx = new ContractCreateFlow()
		.setBytecode(bytecode)
		.setGas(gasLim)
		.setConstructorParameters(
			new ContractFunctionParameters()
				.addAddress(newNftTokenId.toSolidityAddress())
				.addAddress(aliceId.toSolidityAddress())
				.addAddress(aliceId.toSolidityAddress())
				.addAddress(ftTokenId.toSolidityAddress()),
		);
	const contractCreateSubmit = await contractCreateTx.execute(client);
	const contractCreateRx = await contractCreateSubmit.getReceipt(client);
	contractId = contractCreateRx.contractId;
	contractAddress = contractId.toSolidityAddress();
}

/**
 * Helper function for calling the contract methods
 * @param {ContractId} cId the contract to call
 * @param {number | Long.Long} gasLim the max gas
 * @param {string} fcnName name of the function to call
 * @param {ContractFunctionParameters} params the function arguments
 * @param {string | number | Hbar | Long.Long | BigNumber} amountHbar the amount of hbar to send in the methos call
 * @returns {[TransactionReceipt, any]} the transaction receipt and any decoded results
 */
async function contractExecuteFcn(cId, gasLim, fcnName, params, amountHbar) {
	const contractExecuteTx = await new ContractExecuteTransaction()
		.setContractId(cId)
		.setGas(gasLim)
		.setFunction(fcnName, params)
		.setPayableAmount(amountHbar)
		.execute(client);

	// get the results of the function call;
	const record = await contractExecuteTx.getRecord(client);
	const contractResults = decodeFunctionResult(fcnName, record.contractFunctionResult.bytes);
	const contractExecuteRx = await contractExecuteTx.getReceipt(client);
	return [contractExecuteRx, contractResults];
}

/**
 * Decodes the result of a contract's function execution
 * @param functionName the name of the function within the ABI
 * @param resultAsBytes a byte array containing the execution result
 */
function decodeFunctionResult(functionName, resultAsBytes) {
	const functionAbi = abi.find(func => func.name === functionName);
	try {
		const functionParameters = functionAbi.outputs;
		const resultHex = '0x'.concat(Buffer.from(resultAsBytes).toString('hex'));
		const result = web3.eth.abi.decodeParameters(functionParameters, resultHex);
		return result;
	}
	catch (e) {
		return 'No outputs';
	}
}

/**
 * Helper method to encode a contract query function
 * @param {string} functionName name of the function to call
 * @param {string[]} parameters string[] of parameters - typically blank
 * @returns {Buffer} encoded function call
 */
function encodeFunctionCall(functionName, parameters) {
	const functionAbi = abi.find((func) => func.name === functionName && func.type === 'function');
	const encodedParametersHex = web3.eth.abi.encodeFunctionCall(functionAbi, parameters).slice(2);
	return Buffer.from(encodedParametersHex, 'hex');
}

/**
 * Helper function to create new accounts
 * @param {PrivateKey} privateKey new accounts private key
 * @param {string | number} initialBalance initial balance in hbar
 * @returns {AccountId} the nrewly created Account ID object
 */
async function accountCreator(privateKey, initialBalance) {
	const response = await new AccountCreateTransaction()
		.setInitialBalance(new Hbar(initialBalance))
		// .setMaxAutomaticTokenAssociations(5)
		.setKey(privateKey.publicKey)
		.execute(client);
	const receipt = await response.getReceipt(client);
	return receipt.accountId;
}

/**
 * Helper function to mint an NFT and a serial on to that token
 * Using royaltyies to test the (potentially) more complicate case
 */
async function mintNFTs() {
	legacyCollectionNFT_1_TokenId = await mintNFT('NFBFTSwp-NFT-legacy1', 50);
	legacyCollectionNFT_2_TokenId = await mintNFT('NFBFTSwp-NFT-legacy2', 50);
	legacyCollectionNFT_3_TokenId = await mintNFT('NFBFTSwp-NFT-legacy3', 50);
	newNftTokenId = await mintNFT('NFBFTSwp-NFT-newCollection', 150);
}

async function mintNFT(name, supply) {
	const tokenCreateTx = new TokenCreateTransaction()
		.setTokenType(TokenType.NonFungibleUnique)
		.setTokenName(name + aliceId.toString() + new Date().getTime())
		.setTokenSymbol(name + new Date().getTime())
		.setInitialSupply(0)
		.setMaxSupply(supply)
		.setSupplyType(TokenSupplyType.Finite)
		.setTreasuryAccountId(AccountId.fromString(aliceId))
		.setAutoRenewAccountId(AccountId.fromString(aliceId))
		.setSupplyKey(alicePK)
		.setMaxTransactionFee(new Hbar(75, HbarUnit.Hbar));

	tokenCreateTx.freezeWith(client);
	const signedCreateTx = await tokenCreateTx.sign(operatorKey);
	const executionResponse = await signedCreateTx.execute(client);

	/* Get the receipt of the transaction */
	const createTokenRx = await executionResponse.getReceipt(client).catch((e) => {
		console.log(e);
		console.log('Token Create **FAILED*');
	});

	/* Get the token ID from the receipt */
	const tokenIdMinted = createTokenRx.tokenId;
	console.log('NFT Token ID: ' + tokenIdMinted.toString());


	for (let outer = 0; outer < supply; outer++) {

		const tokenMintTx = new TokenMintTransaction().setTokenId(tokenIdMinted);

		for (let i = 0; i < 10; i++) {
			tokenMintTx.addMetadata(Buffer.from('ipfs://bafybeihbyr6ldwpowrejyzq623lv374kggemmvebdyanrayuviufdhi6xu/metadata.json'));
		}

		tokenMintTx.freezeWith(client);

		await tokenMintTx.execute(client);
	}

	return tokenIdMinted;
}

/**
 * Helper method for token association
 * @param {AccountId} account
 * @param {TokenId[]} tokenListToAssociate
 * @returns {any} expected to be a string 'SUCCESS' implies it worked
 */
// eslint-disable-next-line no-unused-vars
async function associateTokensToAccount(account, tokenListToAssociate) {
	// now associate the token to the operator account
	for (let i = 0; i < tokenListToAssociate.length; i++) {
		const associateToken = await new TokenAssociateTransaction()
			.setAccountId(account)
			.setTokenIds([tokenListToAssociate[i].toString()])
			.freezeWith(client);

		const associateTokenTx = await associateToken.execute(client);
		const associateTokenRx = await associateTokenTx.getReceipt(client);

		const associateTokenStatus = associateTokenRx.status;
		if (associateTokenStatus.toString() != 'SUCCESS') {
			return associateTokenStatus.toString();
		}
	}

	return 'SUCCESS';
}

/**
 * Helper function to gather relevant balances
 * @param {AccountId} acctId
 * @returns {[number, Hbar, number]} NFT token balance, hbar balance, $LAZY balance
 */
async function getAccountBalance(acctId) {
	await sleep(1000);

	const query = new AccountInfoQuery()
		.setAccountId(acctId);

	const info = await query.execute(client);


	const tokenMap = info.tokenRelationships;
	const balance = await getAccountNFTBalance(tokenMap, ftTokenId);
	const legacy1 = await getAccountNFTBalance(tokenMap, legacyCollectionNFT_1_TokenId);
	const legacy2 = await getAccountNFTBalance(tokenMap, legacyCollectionNFT_2_TokenId);
	const legacy3 = await getAccountNFTBalance(tokenMap, legacyCollectionNFT_3_TokenId);
	const newNft = await getAccountNFTBalance(tokenMap, newNftTokenId);


	return [balance, info.balance, newNft, legacy1, legacy2, legacy3];
}

async function getAccountNFTBalance(tokenMap, token) {
	let nftBal;
	const tokenBal = tokenMap.get(token.toString());
	if (tokenBal) {
		nftBal = Number(tokenBal.balance);
	}
	else {
		nftBal = -1;
	}

	return nftBal;
}

/**
 * Helper function to get the FT & hbar balance of the contract
 * @returns {[number | Long.Long, Hbar]} The balance of the FT (without decimals)  & Hbar at the SC
 */
async function getContractBalance() {

	const query = new ContractInfoQuery()
		.setContractId(contractId);

	const info = await query.execute(client);

	const tokenMap = info.tokenRelationships;
	const newNft = await getAccountNFTBalance(tokenMap, newNftTokenId);

	return [info.balance, newNft];
}

/**
 * Helper function to send hbar
 * @param {AccountId} sender sender address
 * @param {AccountId} receiver receiver address
 * @param {string | number | BigNumber} amount the amounbt to send
 * @returns {TransactionReceipt | null} the result
 */
async function hbarTransferFcn(sender, senderPK, receiver, amount) {
	const transferTx = new TransferTransaction()
		.addHbarTransfer(sender, -amount)
		.addHbarTransfer(receiver, amount)
		.freezeWith(client);
	const transferSign = await transferTx.sign(senderPK);
	const transferSubmit = await transferSign.execute(client);
	const transferRx = await transferSubmit.getReceipt(client);
	return transferRx.status.toString();
}

/**
 * Generic setter caller
 * @param {string} fcnName
 * @param {TokenId | AccountId | ContractId} value
 * @returns {string}
 */
// eslint-disable-next-line no-unused-vars
async function useSetterAddress(fcnName, value) {
	const gasLim = 200000;
	const params = new ContractFunctionParameters()
		.addAddress(value.toSolidityAddress());
	const [setterAddressRx, , ] = await contractExecuteFcn(contractId, gasLim, fcnName, params);
	return setterAddressRx.status.toString();
}

/**
 * Generic setter caller
 * @param {string} fcnName
 * @param {number} int
 * @returns {string}
 */
// eslint-disable-next-line no-unused-vars
async function useSetterUint256(fcnName, int) {
	const gasLim = 400000;
	const params = new ContractFunctionParameters().addUint256(int);

	const [setterIntArrayRx, setterResult] = await contractExecuteFcn(contractId, gasLim, fcnName, params);
	return [setterIntArrayRx.status.toString(), setterResult];
}

/**
 * Generic setter caller
 * @param {string} fcnName
 * @param {number[]} bytesArray
 * @returns {string}
 */
async function useSetterBytes32Array(fcnName, bytesArray) {
	const gasLim = 8000000;
	const params = new ContractFunctionParameters().addBytes32Array(bytesArray);

	const [setterIntArrayRx, setterResult] = await contractExecuteFcn(contractId, gasLim, fcnName, params);
	return [setterIntArrayRx.status.toString(), setterResult];
}

/**
 * Generic setter caller
 * @param {string} fcnName
 * @param {string[]} hashes
 * @param {number[]} serials
 * @returns {string}
 */
// eslint-disable-next-line no-unused-vars
async function useSetterConfig(fcnName, hashes, serials) {
	const gasLim = 8000000;
	const params = [hashes, serials];

	const [setterIntArrayRx, setterResult] = await contractExecuteWithStructArgs(contractId, gasLim, fcnName, params);
	return [setterIntArrayRx.status.toString(), setterResult];
}

async function contractExecuteWithStructArgs(cId, gasLim, fcnName, params, amountHbar, clientToUse = client) {
	// use web3.eth.abi to encode the struct for sending.
	// console.log('pre-encode:', JSON.stringify(params, null, 4));
	const functionCallAsUint8Array = await encodeFunctionCall(fcnName, params);

	const contractExecuteTx = await new ContractExecuteTransaction()
		.setContractId(cId)
		.setGas(gasLim)
		.setFunctionParameters(functionCallAsUint8Array)
		.setPayableAmount(amountHbar)
		.freezeWith(clientToUse)
		.execute(clientToUse);

	// get the results of the function call;
	const record = await contractExecuteTx.getRecord(clientToUse);
	const contractResults = decodeFunctionResult(fcnName, record.contractFunctionResult.bytes);
	const contractExecuteRx = await contractExecuteTx.getReceipt(clientToUse);
	return [contractExecuteRx, contractResults, record];
}

/**
 * Generic setter caller
 * @param {string} fcnName
 * @param {boolean} value
 * @param {number=} gasLim
 * @returns {string}
 */
// eslint-disable-next-line no-unused-vars
async function useSetterBool(fcnName, value, gasLim = 200000) {
	const params = new ContractFunctionParameters()
		.addBool(value);
	const [setterAddressRx, , ] = await contractExecuteFcn(contractId, gasLim, fcnName, params);
	return setterAddressRx.status.toString();
}

/**
 * Request hbar from the contract
 * @param {AccountId} address
 * @param {number} amount
 * @param {HbarUnit=} units defaults to Hbar as the unit type
 */
async function transferHbarFromContract(address, amount, units = HbarUnit.Hbar) {
	const gasLim = 400000;
	const params = new ContractFunctionParameters()
		.addAddress(address.toSolidityAddress())
		.addUint256(new Hbar(amount, units).toTinybars());
	const [callHbarRx, , ] = await contractExecuteFcn(contractId, gasLim, 'transferHbar', params);
	return callHbarRx.status.toString();
}

/**
 * Helper function to get the current settings of the contract
 * @param {string} fcnName the name of the getter to call
 * @param {string} expectedVar the variable to exeppect to get back
 * @param {number=100000} gasLim allows gas veride
 * @return {*}
 */
// eslint-disable-next-line no-unused-vars
async function getSetting(fcnName, expectedVar, gasLim = 100000) {
	// check the Lazy Token and LSCT addresses
	// generate function call with function name and parameters
	const functionCallAsUint8Array = await encodeFunctionCall(fcnName, []);

	// query the contract
	const contractCall = await new ContractCallQuery()
		.setContractId(contractId)
		.setFunctionParameters(functionCallAsUint8Array)
		.setQueryPayment(new Hbar(1))
		.setGas(gasLim)
		.execute(client);
	const queryResult = await decodeFunctionResult(fcnName, contractCall.bytes);
	// console.log('result', queryResult);
	return queryResult[expectedVar];
}

/**
 * Helper function to get the current settings of the contract
 * @param {String[]} tokenList the name of the getter to call
 * @param {Number[]} serials the variable to exeppect to get back
 * @param {number=300_000} gasLim allows gas overide
 * @return {*}
 */
// eslint-disable-next-line no-unused-vars
async function getSerials(tokenList, serials, gasLim = 300_000) {
	const fcnName = 'getSerials';
	const hashList = [];
	for (let i = 0; i < tokenList.length; i++) {
		const hash = web3.utils.soliditySha3(
			{ t: 'address', v: tokenList[i].toSolidityAddress() },
			{ t: 'uint256', v: serials[i] },
		);
		// console.log(tokenList[i].toString(), '/#', serials[i], '->', hash);
		hashList.push(hash);
	}

	const functionCallAsUint8Array = await encodeFunctionCall(fcnName, [hashList]);

	// query the contract
	const contractCall = await new ContractCallQuery()
		.setContractId(contractId)
		.setFunctionParameters(functionCallAsUint8Array)
		.setQueryPayment(new Hbar(1))
		.setGas(gasLim)
		.execute(client);
	const queryResult = await decodeFunctionResult(fcnName, contractCall.bytes);
	return queryResult['serials'];
}

function sleep(ms) {
	return new Promise(resolve => setTimeout(resolve, ms));
}