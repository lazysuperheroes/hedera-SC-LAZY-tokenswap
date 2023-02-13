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
const contractName = 'LegacyNoRoyaltyB2E';
const env = process.env.ENVIRONMENT ?? null;
const TOKEN_DECIMAL = 1;

const addressRegex = /(\d+\.\d+\.[1-9]\d+)/i;

// reused variable
let contractId;
let contractAddress;
let abi;
let alicePK, aliceId;
let bobPK, bobId;
let tokenId, nftTokenId;
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
		aliceId = await accountCreator(alicePK, 160);
		console.log('Alice account ID:', aliceId.toString(), '\nkey:', alicePK.toString());

		client.setOperator(aliceId, alicePK);
		// mint an FT to act as $LAZY
		await mintFT(aliceId, alicePK);
		// mint three legacy NFT collections from Alice account of 50 serials
		// mint one new collection of 150 serials to swap into
		await mintNFT();

		client.setOperator(operatorId, operatorKey);
		// associate FT/NFT to operator
		let result = await associateTokensToAccount(operatorId, [tokenId]);
		expect(result).to.be.equal('SUCCESS');
		result = await associateTokensToAccount(operatorId, nftTokenId);
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
		await setFungibleAllowance(contractId, aliceId, 5000);

		// create Bob account
		client.setOperator(operatorId, operatorKey);
		bobPK = PrivateKey.generateED25519();
		bobId = await accountCreator(bobPK, 200);
		console.log('Bob account ID:', bobId.toString(), '\nkey:', bobPK.toString());

		// associate the nft token for Bob
		// do not associate FT to see if contract will auto associate as planned
		client.setOperator(bobId, bobPK);
		result = await associateTokensToAccount(bobId, nftTokenId);
		expect(result).to.be.equal('SUCCESS');

		// send 12 NFTs to Bob
		client.setOperator(aliceId, alicePK);
		await sendNFTs(bobId, aliceId, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
		// send 24 NFTs to Operator
		await sendNFTs(operatorId, aliceId, [13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36]);

		// check Alice NFT balance is 64
		const [aliceLazyBal, , aliceNFTBalance] = await getAccountBalance(aliceId);
		expect(aliceNFTBalance).to.be.equal(64);
		expect(aliceLazyBal).to.be.equal(100000);
	});
});

describe('Operator sets up the claim amount', function() {
	it('Should set the claim amount', async function() {
		// set claim amount
		client.setOperator(operatorId, operatorKey);
		const serialList = [];
		const earnRateList = [];
		for (let i = 1; i <= 100; i++) {
			serialList.push(i);
			const earnRate = i % 5 ? (Math.floor(i / 5) + 1) : (Math.floor(i / 5));
			earnRateList.push(earnRate * (10 ** TOKEN_DECIMAL));
		}
		let [result] = await useSetterUint256Arrays('updateSerialBurnAmount', serialList.slice(0, 50), earnRateList.slice(0, 50));
		expect(result).to.be.equal('SUCCESS');
		[result] = await useSetterUint256Arrays('updateSerialBurnAmount', serialList.slice(50), earnRateList.slice(50));
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
			await useSetterAddress('updateLazyToken', tokenId);
		}
		catch (err) {
			errorCount++;
		}
		// update claim NFT
		try {
			await useSetterAddress('updateBurnToEarnToken', nftTokenId);
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
		// add boost
		try {
			await useSetterUint256Arrays('updateSerialBurnAmount', [1], [1]);
		}
		catch (err) {
			errorCount++;
		}
		// remove boost
		try {
			await useSetterUint256Array('removeSerialsBurnAmount', [1]);
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
			expect(TokenId.fromSolidityAddress(lazy).toString() == tokenId.toString()).to.be.true;
		}
		catch (err) {
			errorCount++;
			console.log(err);
		}
		try {
			const nft = await getSetting('getBurnToEarnToken', 'token');
			expect(TokenId.fromSolidityAddress(nft).toString() == nftTokenId.toString()).to.be.true;
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
			const gasLim = 200000;
			const params = new ContractFunctionParameters().addUint256Array([1, 2]);
			const results = await contractExecuteQuery(contractId, gasLim, 'getEarnForSerials', params);
			// console.log('Earn for serial 1 & 2: ', Number(results['amount']));
			expect(Number(results['amount'])).to.be.equal(20);
		}
		catch (err) {
			errorCount++;
			console.log(err);
		}
		try {
			const gasLim = 400000;
			const params = new ContractFunctionParameters().addUint256(5).addUint256(10);
			const results = await contractExecuteQuery(contractId, gasLim, 'getSerialPaymentAmounts', params);
			expect(results[0].length == 5).to.be.true;
			// console.log('Serials & earn amounts for a small batch', JSON.stringify(results, null, 4));
		}
		catch (err) {
			errorCount++;
			console.log(err);
		}
		expect(errorCount).to.be.equal(0);
	});
});

describe('Interaction: ', function() {
	it('Bob can B2E', async function() {
		client.setOperator(bobId, bobPK);
		let [result, amt] = await burnToEarnNFTs([1]);
		expect(result).to.be.equal('SUCCESS');
		expect(amt).to.be.equal(10);
		// check Lazy Balance is now 1
		let [bobLazyBal, , bobNFTBalance] = await getAccountBalance(bobId);
		// console.log('Bob Lazy Balance', bobLazyBal);
		expect(bobLazyBal).to.be.equal(10);
		expect(bobNFTBalance).to.be.equal(11);

		let [aliceLazyBal, , aliceNFTBalance] = await getAccountBalance(aliceId);
		expect(aliceLazyBal).to.be.equal(100000 - bobLazyBal);
		expect(aliceNFTBalance).to.be.equal(65);

		// now burn 11 NFTs
		[result, amt] = await burnToEarnNFTs([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
		expect(result).to.be.equal('SUCCESS');
		expect(amt).to.be.equal(200);
		[bobLazyBal, , bobNFTBalance] = await getAccountBalance(bobId);
		// console.log('Bob Lazy Balance', bobLazyBal);
		expect(bobLazyBal).to.be.equal(210);
		expect(bobNFTBalance).to.be.equal(0);

		[aliceLazyBal, , aliceNFTBalance] = await getAccountBalance(aliceId);
		expect(aliceLazyBal).to.be.equal(100000 - bobLazyBal);
		expect(aliceNFTBalance).to.be.equal(76);

	});

	it('Operator can B2E', async function() {
		client.setOperator(operatorId, operatorKey);
		let [result, amt] = await burnToEarnNFTs([13]);
		expect(result).to.be.equal('SUCCESS');
		expect(amt).to.be.equal(30);
		// check Lazy Balance is now 3
		let [opLazyBal, , opNFTBalance] = await getAccountBalance(operatorId);
		// console.log('Operator Lazy Balance', opLazyBal);
		expect(opLazyBal).to.be.equal(30);
		expect(opNFTBalance).to.be.equal(23);

		let [aliceLazyBal, , aliceNFTBalance] = await getAccountBalance(aliceId);
		expect(aliceLazyBal).to.be.equal(100000 - 210 - opLazyBal);
		expect(aliceNFTBalance).to.be.equal(77);

		// now burn 23 NFTs
		[result, amt] = await burnToEarnNFTs([14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36]);
		expect(result).to.be.equal('SUCCESS');
		expect(amt).to.be.equal(1240);
		[opLazyBal, , opNFTBalance] = await getAccountBalance(operatorId);
		// console.log('Operator Lazy Balance', opLazyBal);
		expect(opLazyBal).to.be.equal(1270);
		expect(opNFTBalance).to.be.equal(0);

		[aliceLazyBal, , aliceNFTBalance] = await getAccountBalance(aliceId);
		expect(aliceLazyBal).to.be.equal(100000 - 210 - opLazyBal);
		expect(aliceNFTBalance).to.be.equal(100);

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
	tokenId = tokenCreateRx.tokenId;
	console.log('FT Minted:', tokenId.toString());
}

/**
 * Helper function to send serial 1 of the minted NFT to Alic for testing
 * @param {AccountId} receiverId
 * @param {AccountId} senderId
 * @param {Number[]} serials
*/
async function sendNFTs(receiverId, senderId, serials) {
	for (let outer = 0; outer < serials.length; outer += 10) {
		const transferTx = await new TransferTransaction();
		for (let inner = 0; (inner < 10 && (inner + outer) < serials.length); inner++) {
			const nft = new NftId(nftTokenId, serials[inner + outer]);
			// console.log('Sending NFT:', nft.toString(), 'to', receiverId.toString(), 'from', senderId.toString());
			transferTx.addNftTransfer(nft, senderId, receiverId);
		}

		transferTx.setTransactionMemo('B2E test NFT transfer')
			.freezeWith(client);

		// eslint-disable-next-line no-unused-vars
		const response = await transferTx.execute(client);
		// const receipt = await response.getReceipt(client);

		// console.log('NFT Transfer Result:', receipt.status.toString());
	}
}


/**
 * Method to encapsulate the staking method to send to graveyard
 * @param {Number[]} serials the list of serials ot stake
 * @returns {string} 'SUCCESS' if it worked
 */
async function burnToEarnNFTs(serials) {
	const params = new ContractFunctionParameters()
		.addUint256Array(serials);
	const [stakingRx, contractResults] = await contractExecuteFcn(contractId, 2000000, 'burnNFTToEarn', params);
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
		.approveTokenAllowance(tokenId, ownerAcct, ctrcttAsAccount, amount)
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
				.addAddress(nftTokenId.toSolidityAddress())
				.addAddress(aliceId.toSolidityAddress())
				.addAddress(aliceId.toSolidityAddress())
				.addAddress(tokenId.toSolidityAddress()),
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
async function mintNFT() {
	const tokenCreateTx = new TokenCreateTransaction()
		.setTokenType(TokenType.NonFungibleUnique)
		.setTokenName('B2E-NoR_NFT' + aliceId.toString())
		.setTokenSymbol('B2E-NoR_NFT')
		.setInitialSupply(0)
		.setMaxSupply(100)
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
	nftTokenId = createTokenRx.tokenId;
	console.log('NFT Token ID: ' + nftTokenId.toString());

	// mint up the 100 supply
	for (let outer = 0; outer < 10; outer++) {

		const tokenMintTx = new TokenMintTransaction().setTokenId(nftTokenId);

		for (let i = 0; i < 10; i++) {
			tokenMintTx.addMetadata(Buffer.from('ipfs://bafybeihbyr6ldwpowrejyzq623lv374kggemmvebdyanrayuviufdhi6xu/metadata.json'));
		}

		tokenMintTx.freezeWith(client);

		await tokenMintTx.execute(client);
	}
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

	let balance;

	const tokenMap = info.tokenRelationships;
	let tokenBal = tokenMap.get(tokenId.toString());

	if (tokenBal) {
		balance = Number(tokenBal.balance);
	}
	else {
		balance = -1;
	}

	let nftBal;
	tokenBal = tokenMap.get(nftTokenId.toString());
	if (tokenBal) {
		nftBal = Number(tokenBal.balance);
	}
	else {
		nftBal = -1;
	}

	return [balance, info.balance, nftBal];
}

/**
 * Helper function to get the FT & hbar balance of the contract
 * @returns {[number | Long.Long, Hbar]} The balance of the FT (without decimals)  & Hbar at the SC
 */
async function getContractBalance() {

	const query = new ContractInfoQuery()
		.setContractId(contractId);

	const info = await query.execute(client);

	return [info.balance];
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
 * @param {number[]} ints
 * @returns {string}
 */
// eslint-disable-next-line no-unused-vars
async function useSetterUint256Array(fcnName, ints) {
	const gasLim = 8000000;
	const params = new ContractFunctionParameters().addUint256Array(ints);

	const [setterIntArrayRx, setterResult] = await contractExecuteFcn(contractId, gasLim, fcnName, params);
	return [setterIntArrayRx.status.toString(), setterResult];
}

/**
 * Generic setter caller
 * @param {string} fcnName
 * @param {number[]} serials
 * @param {number[]} amounts
 * @returns {string}
 */
// eslint-disable-next-line no-unused-vars
async function useSetterUint256Arrays(fcnName, serials, amounts) {
	const gasLim = 8000000;
	const params = new ContractFunctionParameters().addUint256Array(serials).addUint256Array(amounts);

	const [setterIntArrayRx, setterResult] = await contractExecuteFcn(contractId, gasLim, fcnName, params);
	return [setterIntArrayRx.status.toString(), setterResult];
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
		.setMaxQueryPayment(new Hbar(2))
		.setGas(gasLim)
		.execute(client);
	const queryResult = await decodeFunctionResult(fcnName, contractCall.bytes);
	// console.log('result', queryResult);
	return queryResult[expectedVar];
}

/**
 * Helper function for calling the contract methods
 * @param {ContractId} cId the contract to call
 * @param {number | Long.Long} gasLim the max gas
 * @param {string} fcnName name of the function to call
 * @param {ContractFunctionParameters} params the function arguments
 * @returns {[TransactionReceipt, any, TransactionRecord]} the transaction receipt and any decoded results
 */
async function contractExecuteQuery(cId, gasLim, fcnName, params) {
	const contractCall = await new ContractCallQuery()
		.setContractId(cId)
		.setGas(gasLim)
		.setFunction(fcnName, params)
		.setQueryPayment(new Hbar(0.5))
		.execute(client);

	return decodeFunctionResult(fcnName, contractCall.bytes);
}

function sleep(ms) {
	return new Promise(resolve => setTimeout(resolve, ms));
}