const {
	Client,
	AccountId,
	PrivateKey,
	Hbar,
	HbarUnit,
	// eslint-disable-next-line no-unused-vars
	TransactionReceipt,
	// eslint-disable-next-line no-unused-vars
	TokenId,
	// eslint-disable-next-line no-unused-vars
	ContractId,
	ContractFunctionParameters,
} = require('@hashgraph/sdk');
const fs = require('fs');
const { ethers } = require('ethers');
const { expect } = require('chai');
const { describe, it } = require('mocha');
const {
	checkMirrorHbarBalance,
	checkMirrorBalance,
	checkLastMirrorEvent,
} = require('../utils/hederaMirrorHelpers');
const { sleep } = require('../utils/nodeHelpers');
const {
	contractDeployFunction,
	contractExecuteFunction,
	contractExecuteQuery,
	readOnlyEVMFromMirrorNode,
} = require('../utils/solidityHelpers');
const {
	accountCreator,
	associateTokensToAccount,
	mintNFT,
	sendNFT,
	sendHbar,
	sweepHbar,
	setNFTAllowanceAll,
	clearNFTAllowances,
} = require('../utils/hederaHelpers');
const { fail } = require('assert');

require('dotenv').config();

// Get operator from .env file
let operatorKey;
let operatorId;
try {
	operatorKey = PrivateKey.fromStringED25519(process.env.PRIVATE_KEY);
	operatorId = AccountId.fromString(process.env.ACCOUNT_ID);
}
catch (err) {
	console.log('ERROR: Must specify PRIVATE_KEY & ACCOUNT_ID in the .env file');
}

const contractName = 'NoFallbackTokenSwap';
const lazyGasStationName = 'LazyGasStation';
const env = process.env.ENVIRONMENT ?? null;
const LAZY_DECIMAL = process.env.LAZY_DECIMALS ?? 1;
const LAZY_MAX_SUPPLY = process.env.LAZY_MAX_SUPPLY ?? 250_000_000;
const lazyContractCreator = 'LAZYTokenCreator';

const addressRegex = /(\d+\.\d+\.[1-9]\d+)/i;

// reused variable
let contractId;
let contractAddress;
let nfbtsIface;
let alicePK, aliceId;
let bobPK, bobId;
let newNftTokenId, legacyCollectionNFT_1_TokenId, legacyCollectionNFT_2_TokenId, legacyCollectionNFT_3_TokenId;
let client;
let lazyIface;
let lazyTokenId, lazySCT;
let lazyGasStationIface, lazyGasStationId;
const operatorNftAllowances = [];

describe('Deployment: ', function() {
	it('Should deploy the contract and setup conditions', async function() {
		if (operatorKey === undefined || operatorKey == null || operatorId === undefined || operatorId == null) {
			console.log('Environment required, please specify PRIVATE_KEY & ACCOUNT_ID in the .env file');
			process.exit(1);
		}

		console.log('\n-Using ENVIRONMENT:', env);

		if (env.toUpperCase() == 'TEST') {
			client = Client.forTestnet();
			console.log('testing in *TESTNET*');
		}
		else if (env.toUpperCase() == 'MAIN') {
			client = Client.forMainnet();
			console.log('testing in *MAINNET*');
		}
		else if (env.toUpperCase() == 'PREVIEW') {
			client = Client.forPreviewnet();
			console.log('testing in *PREVIEWNET*');
		}
		else if (env.toUpperCase() == 'LOCAL') {
			const node = { '127.0.0.1:50211': new AccountId(3) };
			client = Client.forNetwork(node).setMirrorNetwork('127.0.0.1:5600');
			console.log('testing in *LOCAL*');
			const rootId = AccountId.fromString('0.0.2');
			const rootKey = PrivateKey.fromStringECDSA(
				'302e020100300506032b65700422042091132178e72057a1d7528025956fe39b0b847f200ab59b2fdd367017f3087137',
			);

			// create an operator account on the local node and use this for testing as operator
			client.setOperator(rootId, rootKey);
			operatorKey = PrivateKey.generateED25519();
			operatorId = await accountCreator(client, operatorKey, 1000);
		}
		else {
			console.log(
				'ERROR: Must specify either MAIN or TEST or PREVIEW or LOCAL as environment in .env file',
			);
			return;
		}

		client.setOperator(operatorId, operatorKey);
		// deploy the contract
		console.log('\n-Using Operator:', operatorId.toString());

		console.log('\n-Testing:', contractName);
		// create Alice account
		if (process.env.ALICE_ACCOUNT_ID && process.env.ALICE_PRIVATE_KEY) {
			aliceId = AccountId.fromString(process.env.ALICE_ACCOUNT_ID);
			alicePK = PrivateKey.fromStringED25519(process.env.ALICE_PRIVATE_KEY);
			console.log('\n-Using existing Alice:', aliceId.toString());

			await sendHbar(client, operatorId, aliceId, 250, HbarUnit.Hbar);
		}
		else {
			alicePK = PrivateKey.generateED25519();
			aliceId = await accountCreator(client, alicePK, 250);
			console.log(
				'Alice account ID:',
				aliceId.toString(),
				'\nkey:',
				alicePK.toString(),
			);
		}
		expect(aliceId.toString().match(addressRegex).length == 2).to.be.true;

		// create Bob account
		if (process.env.BOB_ACCOUNT_ID && process.env.BOB_PRIVATE_KEY) {
			bobId = AccountId.fromString(process.env.BOB_ACCOUNT_ID);
			bobPK = PrivateKey.fromStringED25519(process.env.BOB_PRIVATE_KEY);
			console.log('\n-Using existing Bob:', bobId.toString());

			// send Bob some hbars
			await sendHbar(client, operatorId, bobId, 50, HbarUnit.Hbar);
		}
		else {
			bobPK = PrivateKey.generateED25519();
			bobId = await accountCreator(client, bobPK, 50);
			console.log(
				'Bob account ID:',
				bobId.toString(),
				'\nkey:',
				bobPK.toString(),
			);
		}
		expect(bobId.toString().match(addressRegex).length == 2).to.be.true;

		client.setOperator(aliceId, alicePK);
		// mint three legacy NFT collections from Alice account of 50 serials
		// mint one new collection of 150 serials to swap into

		client.setOperator(aliceId, alicePK);
		let result;
		[result, legacyCollectionNFT_1_TokenId] = await mintNFT(
			client,
			aliceId,
			'NFBFTSwp-NFT-legacy1',
			'NFBFTSwp1',
			50,
			50,
			null,
			null,
			true,
		);
		expect(result).to.be.equal('SUCCESS');

		[result, legacyCollectionNFT_2_TokenId] = await mintNFT(
			client,
			aliceId,
			'NFBFTSwp-NFT-legacy2',
			'NFBFTSwp2',
			50,
			50,
			null,
			null,
			true,
		);
		expect(result).to.be.equal('SUCCESS');

		[result, legacyCollectionNFT_3_TokenId] = await mintNFT(
			client,
			aliceId,
			'NFBFTSwp-NFT-legacy3',
			'NFBFTSwp3',
			50,
			50,
			null,
			null,
			true,
		);
		expect(result).to.be.equal('SUCCESS');

		[result, newNftTokenId] = await mintNFT(
			client,
			aliceId,
			'NFBFTSwp-NFT-newCollection',
			'NFBFTSwpNew',
			150,
			50,
			null,
			null,
			true,
		);
		expect(result).to.be.equal('SUCCESS');

		// deploy the contract
		console.log('\n-Using Operator:', operatorId.toString());

		client.setOperator(operatorId, operatorKey);

		// check if LAZY SCT has been deployed
		const lazyJson = JSON.parse(
			fs.readFileSync(
				`./artifacts/contracts/legacy/${lazyContractCreator}.sol/${lazyContractCreator}.json`,
			),
		);

		// import ABIs
		lazyIface = new ethers.Interface(lazyJson.abi);

		const lazyContractBytecode = lazyJson.bytecode;

		let lazyDeploySkipped = false;
		if (process.env.LAZY_SCT_CONTRACT_ID && process.env.LAZY_TOKEN_ID) {
			console.log(
				'\n-Using existing LAZY SCT:',
				process.env.LAZY_SCT_CONTRACT_ID,
			);
			lazySCT = ContractId.fromString(process.env.LAZY_SCT_CONTRACT_ID);

			lazyDeploySkipped = true;

			lazyTokenId = TokenId.fromString(process.env.LAZY_TOKEN_ID);
			console.log('\n-Using existing LAZY Token ID:', lazyTokenId.toString());
		}
		else {
			const gasLimit = 800_000;

			console.log(
				'\n- Deploying contract...',
				lazyContractCreator,
				'\n\tgas@',
				gasLimit,
			);

			[lazySCT] = await contractDeployFunction(client, lazyContractBytecode);

			console.log(
				`Lazy Token Creator contract created with ID: ${lazySCT} / ${lazySCT.toSolidityAddress()}`,
			);

			expect(lazySCT.toString().match(addressRegex).length == 2).to.be.true;

			// mint the $LAZY FT
			await mintLazy(
				'Test_Lazy',
				'TLazy',
				'Test Lazy FT',
				LAZY_MAX_SUPPLY * 10 ** LAZY_DECIMAL,
				LAZY_DECIMAL,
				LAZY_MAX_SUPPLY * 10 ** LAZY_DECIMAL,
				30,
			);
			console.log('$LAZY Token minted:', lazyTokenId.toString());
		}

		expect(lazySCT.toString().match(addressRegex).length == 2).to.be.true;
		expect(lazyTokenId.toString().match(addressRegex).length == 2).to.be.true;

		const lazyGasStationJSON = JSON.parse(
			fs.readFileSync(
				`./artifacts/contracts/${lazyGasStationName}.sol/${lazyGasStationName}.json`,
			),
		);

		lazyGasStationIface = new ethers.Interface(lazyGasStationJSON.abi);
		if (process.env.LAZY_GAS_STATION_CONTRACT_ID) {
			console.log(
				'\n-Using existing Lazy Gas Station:',
				process.env.LAZY_GAS_STATION_CONTRACT_ID,
			);
			lazyGasStationId = ContractId.fromString(
				process.env.LAZY_GAS_STATION_CONTRACT_ID,
			);
		}
		else {
			const gasLimit = 1_500_000;
			console.log(
				'\n- Deploying contract...',
				lazyGasStationName,
				'\n\tgas@',
				gasLimit,
			);

			const lazyGasStationBytecode = lazyGasStationJSON.bytecode;

			const lazyGasStationParams = new ContractFunctionParameters()
				.addAddress(lazyTokenId.toSolidityAddress())
				.addAddress(lazySCT.toSolidityAddress());

			[lazyGasStationId] = await contractDeployFunction(
				client,
				lazyGasStationBytecode,
				gasLimit,
				lazyGasStationParams,
			);

			console.log(
				`Lazy Gas Station contract created with ID: ${lazyGasStationId} / ${lazyGasStationId.toSolidityAddress()}`,
			);

			expect(lazyGasStationId.toString().match(addressRegex).length == 2).to.be
				.true;
		}


		const json = JSON.parse(fs.readFileSync(`./artifacts/contracts/${contractName}.sol/${contractName}.json`));

		nfbtsIface = new ethers.Interface(json.abi);

		const contractBytecode = json.bytecode;
		const gasLimit = 4_500_000;

		console.log('\n- Deploying contract...', contractName, '\n\tgas@', gasLimit);

		const constructorParams = new ContractFunctionParameters()
			.addAddress(newNftTokenId.toSolidityAddress())
			.addAddress(aliceId.toSolidityAddress())
			.addAddress(lazyGasStationId.toSolidityAddress())
			.addAddress(lazyTokenId.toSolidityAddress());

		[contractId, contractAddress] = await contractDeployFunction(client, contractBytecode, gasLimit, constructorParams);

		console.log(`Contract created with ID: ${contractId} / ${contractAddress}`);

		expect(contractId.toString().match(addressRegex).length == 2).to.be.true;

		console.log('\n-Testing:', contractName);

		// send 1 hbar to the contract.
		await sendHbar(client, operatorId, AccountId.fromString(contractId.toString()), 1, HbarUnit.Hbar);

		const operatorTokensToAssociate = [];
		if (!lazyDeploySkipped) {
			operatorTokensToAssociate.push(lazyTokenId);
		}
		operatorTokensToAssociate.push(
			legacyCollectionNFT_1_TokenId,
			legacyCollectionNFT_2_TokenId,
			legacyCollectionNFT_3_TokenId,
			newNftTokenId,
		);

		result = await associateTokensToAccount(
			client,
			operatorId,
			operatorKey,
			operatorTokensToAssociate,
		);

		expect(result).to.be.equal('SUCCESS');

		// v2.0 move to LGS vs. direct allowance
		// await setLSCTAllowance(50_000);

		// associate the token for Alice
		// alice has the NFTs already associated

		// check the balance of lazy tokens for Alice from mirror node
		const aliceLazyBalance = await checkMirrorBalance(
			env,
			aliceId,
			lazyTokenId,
		);

		if (!aliceLazyBalance) {
			result = await associateTokensToAccount(client, aliceId, alicePK, [
				lazyTokenId,
			]);
			expect(result).to.be.equal('SUCCESS');
		}

		// associate the nft token for Bob
		// check the balance of lazy tokens for Bob from mirror node
		const bobLazyBalance = await checkMirrorBalance(env, bobId, lazyTokenId);

		const bobTokensToAssociate = [];
		if (!bobLazyBalance) {
			bobTokensToAssociate.push(lazyTokenId);
		}

		bobTokensToAssociate.push(
			legacyCollectionNFT_1_TokenId,
			legacyCollectionNFT_2_TokenId,
			legacyCollectionNFT_3_TokenId,
			newNftTokenId,
		);

		// associate the tokens for Bob
		result = await associateTokensToAccount(
			client,
			bobId,
			bobPK,
			bobTokensToAssociate,
		);
		expect(result).to.be.equal('SUCCESS');

		// send $LAZY to all accounts
		client.setOperator(operatorId, operatorKey);
		result = await sendLazy(operatorId, 100);
		expect(result).to.be.equal('SUCCESS');
		result = await sendLazy(aliceId, 100);
		expect(result).to.be.equal('SUCCESS');
		result = await sendLazy(bobId, 100);
		expect(result).to.be.equal('SUCCESS');

		// send $LAZY to the Lazy Gas Station
		// gas station will fuel payouts so ensure it has enough
		result = await sendLazy(lazyGasStationId, 100_000);
		expect(result).to.be.equal('SUCCESS');

		// send 12 NFTs to Bob
		client.setOperator(aliceId, alicePK);
		await sendNFT(client, aliceId, bobId, legacyCollectionNFT_1_TokenId, generateSerials(1, 12));
		await sendNFT(client, aliceId, bobId, legacyCollectionNFT_2_TokenId, generateSerials(13, 24));
		await sendNFT(client, aliceId, bobId, legacyCollectionNFT_3_TokenId, generateSerials(7, 18));
		// send 25 NFTs to Operator
		await sendNFT(client, aliceId, operatorId, legacyCollectionNFT_1_TokenId, generateSerials(26, 50));
		await sendNFT(client, aliceId, operatorId, legacyCollectionNFT_2_TokenId, generateSerials(26, 50));
		await sendNFT(client, aliceId, operatorId, legacyCollectionNFT_3_TokenId, generateSerials(26, 50));

		// sent the new NFTs to the contract
		await sendNFT(client, aliceId, AccountId.fromString(contractId.toString()), newNftTokenId, generateSerials(1, 150));

		await sleep(5000);

		// check alice balance of the NFTs
		const aliceLegacy1Bal = await checkMirrorBalance(env, aliceId, legacyCollectionNFT_1_TokenId);
		const aliceLegacy2Bal = await checkMirrorBalance(env, aliceId, legacyCollectionNFT_2_TokenId);
		const aliceLegacy3Bal = await checkMirrorBalance(env, aliceId, legacyCollectionNFT_3_TokenId);
		const aliceNewNFTBalance = await checkMirrorBalance(env, aliceId, newNftTokenId);
		const aliceLazyBal = await checkMirrorBalance(env, aliceId, lazyTokenId);

		expect(aliceNewNFTBalance).to.be.equal(0);
		expect(aliceLegacy1Bal).to.be.equal(13);
		expect(aliceLegacy2Bal).to.be.equal(13);
		expect(aliceLegacy3Bal).to.be.equal(13);
		expect(aliceLazyBal).to.be.equal(100);

		client.setOperator(operatorId, operatorKey);
		// add the LazyNFTStaker to the lazy gas station as a contract user
		result = await contractExecuteFunction(
			lazyGasStationId,
			lazyGasStationIface,
			client,
			null,
			'addContractUser',
			[contractId.toSolidityAddress()],
		);

		if (result[0]?.status.toString() != 'SUCCESS') {
			console.log('ERROR adding NFBTS to LGS:', result);
			fail();
		}

		// check the GasStationAccessControlEvent on the mirror node
		await sleep(4500);
		const lgsEvent = await checkLastMirrorEvent(
			env,
			lazyGasStationId,
			lazyGasStationIface,
			1,
			true,
		);

		expect(lgsEvent.toSolidityAddress().toLowerCase()).to.be.equal(
			contractId.toSolidityAddress(),
		);
	});
});

describe('Operator sets up the claim amount', function() {
	it('Should setup the swaps', async function() {
		// set claim amount
		client.setOperator(operatorId, operatorKey);

		// set claim $LAZY amount using updateClaimAmount
		let result = await contractExecuteFunction(
			contractId,
			nfbtsIface,
			client,
			null,
			'updateClaimAmount',
			[100],
		);

		if (result[0]?.status?.toString() !== 'SUCCESS') {
			console.log('Failed to set claim amount:', result);
			fail();
		}

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
			swapHashList.push(ethers.solidityPackedKeccak256(
				['address', 'uint256'],
				[tokenForConfig.toSolidityAddress(), serial],
			));
		}
		// update the config using updateSwapConfig
		result = await contractExecuteFunction(
			contractId,
			nfbtsIface,
			client,
			3_600_000,
			'updateSwapConfig',
			[newSerialList.slice(0, 50), swapHashList.slice(0, 50)],
		);

		if (result[0]?.status?.toString() !== 'SUCCESS') {
			console.log('Failed to set swap config:', result);
			fail();
		}

		// show the tx Id
		console.log('Tx ID:', result[2]?.transactionId?.toString());

		result = await contractExecuteFunction(
			contractId,
			nfbtsIface,
			client,
			3_600_000,
			'updateSwapConfig',
			[newSerialList.slice(50, 100), swapHashList.slice(50, 100)],
		);

		if (result[0]?.status?.toString() !== 'SUCCESS') {
			console.log('Failed to set swap config (2):', result);
			fail();
		}

		result = await contractExecuteFunction(
			contractId,
			nfbtsIface,
			client,
			3_600_000,
			'updateSwapConfig',
			[newSerialList.slice(100), swapHashList.slice(100)],
		);

		if (result[0]?.status?.toString() !== 'SUCCESS') {
			console.log('Failed to set swap config (3):', result);
			fail();
		}
	});

	it('Should unpause the contract', async function() {

		// check the contract is paused via mirror nodes
		const encodedFunction = nfbtsIface.encodeFunctionData('paused');

		const pausedResult = await readOnlyEVMFromMirrorNode(
			env,
			contractId,
			encodedFunction,
			operatorId,
			false,
		);

		const paused = nfbtsIface.decodeFunctionResult('paused', pausedResult);

		expect(paused[0]).to.be.true;

		// updatePauseStatus
		client.setOperator(operatorId, operatorKey);
		const result = await contractExecuteFunction(
			contractId,
			nfbtsIface,
			client,
			null,
			'updatePauseStatus',
			[false],
		);

		if (result[0]?.status?.toString() !== 'SUCCESS') {
			console.log('Failed to unpause the contract:', result);
			fail();
		}
	});
});

describe('Access Checks: ', function() {
	it('Alice cant call sensitive methods', async function() {
		client.setOperator(aliceId, alicePK);
		// update FT SCT
		let result = await contractExecuteFunction(
			contractId,
			nfbtsIface,
			client,
			null,
			'updateLGS',
			[lazySCT.toSolidityAddress()],
		);

		if (result[0]?.status?.toString() != 'REVERT: Ownable: caller is not the owner') {
			console.log('ERROR executing updateLGS - expected failure but got:', result);
			fail();
		}

		result = await contractExecuteFunction(
			contractId,
			nfbtsIface,
			client,
			null,
			'updateLazyToken',
			[lazySCT.toSolidityAddress()],
		);

		if (result[0]?.status?.toString() != 'REVERT: Ownable: caller is not the owner') {
			console.log('ERROR executing updateLazyToken - expected failure but got:', result);
			fail();
		}

		result = await contractExecuteFunction(
			contractId,
			nfbtsIface,
			client,
			null,
			'updateSwapToken',
			[lazySCT.toSolidityAddress()],
		);

		if (result[0]?.status?.toString() != 'REVERT: Ownable: caller is not the owner') {
			console.log('ERROR executing updateSwapToken - expected failure but got:', result);
			fail();
		}

		result = await contractExecuteFunction(
			contractId,
			nfbtsIface,
			client,
			null,
			'updatePauseStatus',
			[true],
		);

		if (result[0]?.status?.toString() != 'REVERT: Ownable: caller is not the owner') {
			console.log('ERROR executing updatePauseStatus - expected failure but got:', result);
			fail();
		}

		result = await contractExecuteFunction(
			contractId,
			nfbtsIface,
			client,
			null,
			'updateSwapConfig',
			[[1], [ethers.solidityPackedKeccak256(
				['address', 'uint256'],
				[newNftTokenId.toSolidityAddress(), 9999],
			)]],
		);

		if (result[0]?.status?.toString() != 'REVERT: Ownable: caller is not the owner') {
			console.log('ERROR executing updateSwapConfig - expected failure but got:', result);
			fail();
		}

		// remove config
		result = await contractExecuteFunction(
			contractId,
			nfbtsIface,
			client,
			null,
			'removeSwapConfig',
			[[ethers.solidityPackedKeccak256(
				['address', 'uint256'],
				[newNftTokenId.toSolidityAddress(), 9999],
			)]],
		);

		if (result[0]?.status?.toString() != 'REVERT: Ownable: caller is not the owner') {
			console.log('ERROR executing removeSwapConfig - expected failure but got:', result);
			fail();
		}
		// transfer Hbar
		result = await contractExecuteFunction(
			contractId,
			nfbtsIface,
			client,
			300_000,
			'transferHbar',
			[operatorId.toSolidityAddress(), 1],
		);

		if (result[0]?.status?.toString() != 'REVERT: Ownable: caller is not the owner') {
			console.log('ERROR executing transferHbar - expected failure but got:', result);
			fail();
		}
	});

	it('Alice can call regular methods', async function() {
		client.setOperator(aliceId, alicePK);

		// contract query for the public variables
		let result = await contractExecuteQuery(
			contractId,
			nfbtsIface,
			client,
			null,
			'lazyGasStation',
		);

		expect(result[0].toString().slice(2).toLowerCase()).to.be.equal(lazyGasStationId.toSolidityAddress().toString().toLowerCase());

		// lazyToken
		result = await contractExecuteQuery(
			contractId,
			nfbtsIface,
			client,
			null,
			'lazyToken',
		);

		expect(result[0].toString().slice(2).toLowerCase()).to.be.equal(lazyTokenId.toSolidityAddress().toString().toLowerCase());

		// swapToken
		result = await contractExecuteQuery(
			contractId,
			nfbtsIface,
			client,
			null,
			'swapToken',
		);

		expect(result[0].toString().slice(2).toLowerCase()).to.be.equal(newNftTokenId.toSolidityAddress().toString().toLowerCase());

		// getSerials
		const swapHashList = [];
		swapHashList.push(ethers.solidityPackedKeccak256(
			['address', 'uint256'],
			[legacyCollectionNFT_1_TokenId.toSolidityAddress(), 1],
		));
		swapHashList.push(ethers.solidityPackedKeccak256(
			['address', 'uint256'],
			[legacyCollectionNFT_2_TokenId.toSolidityAddress(), 1],
		));

		result = await contractExecuteQuery(
			contractId,
			nfbtsIface,
			client,
			null,
			'getSerials',
			[swapHashList],
		);

		console.log('Alice Serials:', result);

		expect(result[0].length).to.be.equal(2);
		expect(result[0][0]).to.be.equal(1);
		expect(result[0][1]).to.be.equal(51);
	});
});

describe('Interaction: ', function() {
	it('Bob can Swap', async function() {
		client.setOperator(bobId, bobPK);

		// get Bob $LAZY balance
		const origBobLazyBal = await checkMirrorBalance(env, bobId, lazyTokenId);

		// set NFT allowance
		const allowanceSet = await setNFTAllowanceAll(
			client,
			[legacyCollectionNFT_1_TokenId, legacyCollectionNFT_2_TokenId, legacyCollectionNFT_3_TokenId],
			bobId,
			AccountId.fromString(contractId.toString()),
		);

		expect(allowanceSet).to.be.equal('SUCCESS');

		// call swapNFTs for token 1, serial 1
		let result = await contractExecuteFunction(
			contractId,
			nfbtsIface,
			client,
			750_000,
			'swapNFTs',
			[[legacyCollectionNFT_1_TokenId.toSolidityAddress()], [1]],
		);

		if (result[0]?.status?.toString() !== 'SUCCESS') {
			console.log('Failed to swap NFTs:', result);
			fail();
		}

		// show tx Id
		console.log('Bob Swap Tx ID:', result[2]?.transactionId?.toString());

		expect(Number(result[1])).to.be.equal(100);

		await sleep(5000);
		// check Lazy Balance is now +100
		const bobLazyBal = await checkMirrorBalance(env, bobId, lazyTokenId);
		const bobNFTBalance = await checkMirrorBalance(env, bobId, newNftTokenId);
		const bobLegacy1Bal = await checkMirrorBalance(env, bobId, legacyCollectionNFT_1_TokenId);
		const bobLegacy2Bal = await checkMirrorBalance(env, bobId, legacyCollectionNFT_2_TokenId);
		const bobLegacy3Bal = await checkMirrorBalance(env, bobId, legacyCollectionNFT_3_TokenId);

		expect(bobLazyBal).to.be.equal(100 + origBobLazyBal);
		expect(bobNFTBalance).to.be.equal(1);
		expect(bobLegacy1Bal).to.be.equal(11);
		expect(bobLegacy2Bal).to.be.equal(12);
		expect(bobLegacy3Bal).to.be.equal(12);

		let aliceLegacy1Bal = await checkMirrorBalance(env, aliceId, legacyCollectionNFT_1_TokenId);
		expect(aliceLegacy1Bal).to.be.equal(14);


		// check contract balance
		let contractNFTBalance = await checkMirrorBalance(env, contractId, newNftTokenId);
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

		result = await contractExecuteFunction(
			contractId,
			nfbtsIface,
			client,
			4_500_000,
			'swapNFTs',
			[tokenAddressList, serialList],
		);

		if (result[0]?.status?.toString() !== 'SUCCESS') {
			console.log('Failed to swap NFTs:', result);
			fail();
		}

		// show tx Id
		console.log('Bob Swap Tx ID:', result[2]?.transactionId?.toString());

		expect(Number(result[1])).to.be.equal(3500);

		await sleep(5500);

		const newBobLazyBal = await checkMirrorBalance(env, bobId, lazyTokenId);
		const newBobNFTBalance = await checkMirrorBalance(env, bobId, newNftTokenId);
		const newBobLegacy1Bal = await checkMirrorBalance(env, bobId, legacyCollectionNFT_1_TokenId);
		const newBobLegacy2Bal = await checkMirrorBalance(env, bobId, legacyCollectionNFT_2_TokenId);
		const newBobLegacy3Bal = await checkMirrorBalance(env, bobId, legacyCollectionNFT_3_TokenId);

		expect(newBobLazyBal).to.be.equal(3500 + bobLazyBal);
		expect(newBobNFTBalance).to.be.equal(36);
		expect(newBobLegacy1Bal).to.be.equal(0);
		expect(newBobLegacy2Bal).to.be.equal(0);
		expect(newBobLegacy3Bal).to.be.equal(0);


		aliceLegacy1Bal = await checkMirrorBalance(env, aliceId, legacyCollectionNFT_1_TokenId);
		const aliceLegacy2Bal = await checkMirrorBalance(env, aliceId, legacyCollectionNFT_2_TokenId);
		const aliceLegacy3Bal = await checkMirrorBalance(env, aliceId, legacyCollectionNFT_3_TokenId);

		expect(aliceLegacy1Bal).to.be.equal(25);
		expect(aliceLegacy2Bal).to.be.equal(25);
		expect(aliceLegacy3Bal).to.be.equal(25);

		contractNFTBalance = await checkMirrorBalance(env, contractId, newNftTokenId);
		expect(contractNFTBalance).to.be.equal(114);

	});

	it('Operator can Swap', async function() {
		client.setOperator(operatorId, operatorKey);

		const origOperatorLazyBal = await checkMirrorBalance(env, operatorId, lazyTokenId);

		const allowanceSet = await setNFTAllowanceAll(
			client,
			[legacyCollectionNFT_1_TokenId, legacyCollectionNFT_2_TokenId, legacyCollectionNFT_3_TokenId],
			operatorId,
			AccountId.fromString(contractId.toString()),
		);

		operatorNftAllowances.push({ tokenId: legacyCollectionNFT_1_TokenId, owner: operatorId, spender: AccountId.fromString(contractId.toString()) });
		operatorNftAllowances.push({ tokenId: legacyCollectionNFT_2_TokenId, owner: operatorId, spender: AccountId.fromString(contractId.toString()) });
		operatorNftAllowances.push({ tokenId: legacyCollectionNFT_3_TokenId, owner: operatorId, spender: AccountId.fromString(contractId.toString()) });

		expect(allowanceSet).to.be.equal('SUCCESS');

		let result = await contractExecuteFunction(
			contractId,
			nfbtsIface,
			client,
			300_000,
			'swapNFTs',
			[[legacyCollectionNFT_1_TokenId.toSolidityAddress()], [26]],
		);

		if (result[0]?.status?.toString() !== 'SUCCESS') {
			console.log('Failed to swap NFTs (singular):', result);
			fail();
		}

		// show tx Id
		console.log('Operator Swap Tx ID:', result[2]?.transactionId?.toString());

		expect(Number(result[1])).to.be.equal(100);

		await sleep(5000);

		const operatorLazyBal = await checkMirrorBalance(env, operatorId, lazyTokenId);
		const operatorNFTBalance = await checkMirrorBalance(env, operatorId, newNftTokenId);
		const operatorLegacy1Bal = await checkMirrorBalance(env, operatorId, legacyCollectionNFT_1_TokenId);
		const operatorLegacy2Bal = await checkMirrorBalance(env, operatorId, legacyCollectionNFT_2_TokenId);
		const operatorLegacy3Bal = await checkMirrorBalance(env, operatorId, legacyCollectionNFT_3_TokenId);

		expect(operatorLazyBal).to.be.equal(100 + origOperatorLazyBal);
		expect(operatorNFTBalance).to.be.equal(1);
		expect(operatorLegacy1Bal).to.be.equal(24);
		expect(operatorLegacy2Bal).to.be.equal(25);
		expect(operatorLegacy3Bal).to.be.equal(25);

		let aliceLegacy1Bal = await checkMirrorBalance(env, aliceId, legacyCollectionNFT_1_TokenId);
		expect(aliceLegacy1Bal).to.be.equal(26);

		// check contract balance
		let contractNFTBalance = await checkMirrorBalance(env, contractId, newNftTokenId);
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

		result = await contractExecuteFunction(
			contractId,
			nfbtsIface,
			client,
			4_500_000,
			'swapNFTs',
			[tokenAddressList, serialList],
		);

		if (result[0]?.status?.toString() !== 'SUCCESS') {
			console.log('Failed to swap NFTs (multi):', result);
			fail();
		}

		// show tx Id
		console.log('Operator Bulk Swap Tx ID:', result[2]?.transactionId?.toString());

		expect(Number(result[1])).to.be.equal(7400);

		await sleep(5000);

		const newOperatorLazyBal = await checkMirrorBalance(env, operatorId, lazyTokenId);
		const newOperatorNFTBalance = await checkMirrorBalance(env, operatorId, newNftTokenId);
		const newOperatorLegacy1Bal = await checkMirrorBalance(env, operatorId, legacyCollectionNFT_1_TokenId);
		const newOperatorLegacy2Bal = await checkMirrorBalance(env, operatorId, legacyCollectionNFT_2_TokenId);
		const newOperatorLegacy3Bal = await checkMirrorBalance(env, operatorId, legacyCollectionNFT_3_TokenId);

		expect(newOperatorLazyBal).to.be.equal(7400 + operatorLazyBal);
		expect(newOperatorNFTBalance).to.be.equal(75);
		expect(newOperatorLegacy1Bal).to.be.equal(0);
		expect(newOperatorLegacy2Bal).to.be.equal(0);
		expect(newOperatorLegacy3Bal).to.be.equal(0);

		aliceLegacy1Bal = await checkMirrorBalance(env, aliceId, legacyCollectionNFT_1_TokenId);
		const aliceLegacy2Bal = await checkMirrorBalance(env, aliceId, legacyCollectionNFT_2_TokenId);
		const aliceLegacy3Bal = await checkMirrorBalance(env, aliceId, legacyCollectionNFT_3_TokenId);

		expect(aliceLegacy1Bal).to.be.equal(50);
		expect(aliceLegacy2Bal).to.be.equal(50);
		expect(aliceLegacy3Bal).to.be.equal(50);

		contractNFTBalance = await checkMirrorBalance(env, contractId, newNftTokenId);
		expect(contractNFTBalance).to.be.equal(39);
	});

	// not testing Alice as that account is treasury so no movmeent can occur.

	it('Test where Swap config is missing', async function() {
		client.setOperator(operatorId, operatorKey);

		const result = await contractExecuteFunction(
			contractId,
			nfbtsIface,
			client,
			300_000,
			'swapNFTs',
			[[newNftTokenId.toSolidityAddress()], [1]],
		);

		console.log('Result:', result);

		// expect a ConfigNotFound error
		if (result[0]?.status?.name != 'ConfigNotFound') {
			console.log('ERROR expecting ConfigNotFound');
			fail();
		}
	});

	describe('Cleanup: ', function() {
		it('Operator removes allowances', async function() {
			client.setOperator(operatorId, operatorKey);

			if (operatorNftAllowances.length != 0) {
				const result = await clearNFTAllowances(client, operatorNftAllowances);
				expect(result).to.be.equal('SUCCESS');
			}
		});

		it('Cleans up LGS', async function() {
			// clean up the LGS authorizations
			const lgsContractUsers = await contractExecuteQuery(
				lazyGasStationId,
				lazyGasStationIface,
				client,
				null,
				'getContractUsers',
			);

			for (let i = 0; i < lgsContractUsers[0].length; i++) {
				const result = await contractExecuteFunction(
					lazyGasStationId,
					lazyGasStationIface,
					client,
					300_000,
					'removeContractUser',
					[lgsContractUsers[0][i]],
				);

				if (result[0]?.status.toString() !== 'SUCCESS') {console.log('Failed to remove LGS contract user:', result);}
				expect(result[0].status.toString()).to.be.equal('SUCCESS');
			}
		});

		it('Retrieve any hbar spent', async function() {
			client.setOperator(operatorId, operatorKey);
			// v2.0 move to LGS vs. direct allowance
			// await revokeLSCTAllowance();

			await sleep(5000);
			let balance = await checkMirrorHbarBalance(env, aliceId);
			balance -= 1_000_000;
			console.log('sweeping alice', balance / 10 ** 8);
			let result = await sweepHbar(client, aliceId, alicePK, operatorId, new Hbar(balance, HbarUnit.Tinybar));
			console.log('alice:', result);

			balance = await checkMirrorHbarBalance(env, bobId);
			balance -= 1_000_000;
			console.log('sweeping bob', balance / 10 ** 8);
			result = await sweepHbar(client, bobId, bobPK, operatorId, new Hbar(balance, HbarUnit.Tinybar));
			console.log('bob:', result);

			balance = await checkMirrorHbarBalance(env, contractId);
			balance -= 1_000_000;
			result = await contractExecuteFunction(
				contractId,
				nfbtsIface,
				client,
				300_000,
				'transferHbar',
				[operatorId.toSolidityAddress(), balance],
			);
			console.log('contract:', result[0]?.status?.toString());
		});
	});
});

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
 * Helper function to encpapsualte minting an FT
 * @param {string} tokenName
 * @param {string} tokenSymbol
 * @param {string} tokenMemo
 * @param {number} tokenInitalSupply
 * @param {number} tokenDecimal
 * @param {number} tokenMaxSupply
 * @param {number} payment
 */
async function mintLazy(
	tokenName,
	tokenSymbol,
	tokenMemo,
	tokenInitalSupply,
	decimal,
	tokenMaxSupply,
	payment,
) {
	const gasLim = 800000;
	// call associate method
	const params = [
		tokenName,
		tokenSymbol,
		tokenMemo,
		tokenInitalSupply,
		decimal,
		tokenMaxSupply,
	];

	const [, , createTokenRecord] = await contractExecuteFunction(
		lazySCT,
		lazyIface,
		client,
		gasLim,
		'createFungibleWithBurn',
		params,
		payment,
	);
	const tokenIdSolidityAddr =
		createTokenRecord.contractFunctionResult.getAddress(0);
	lazyTokenId = TokenId.fromSolidityAddress(tokenIdSolidityAddr);
}

/**
 * Use the LSCT to send $LAZY out
 * @param {AccountId} receiverId
 * @param {*} amt
 */
async function sendLazy(receiverId, amt) {
	const result = await contractExecuteFunction(
		lazySCT,
		lazyIface,
		client,
		300_000,
		'transferHTS',
		[lazyTokenId.toSolidityAddress(), receiverId.toSolidityAddress(), amt],
	);
	if (result[0]?.status?.toString() !== 'SUCCESS') {
		console.log('Failed to send $LAZY:', result);
		fail();
	}
	return result[0]?.status.toString();
}

// eslint-disable-next-line no-unused-vars
async function setLSCTAllowance(amount) {
	const fudgedContractId = AccountId.fromString(contractId.toString());
	// call addAllowanceWhitelist to add the desployed swap contract
	const result = await contractExecuteFunction(
		lazySCT,
		lazyIface,
		client,
		300_000,
		'addAllowanceWhitelist',
		[fudgedContractId.toSolidityAddress()],
	);

	if (result[0]?.status?.toString() !== 'SUCCESS') {
		console.log('Failed to add allowance whitelist:', result);
		fail();
	}

	// call approveAllowance to approve the amount
	const result2 = await contractExecuteFunction(
		lazySCT,
		lazyIface,
		client,
		950_000,
		'approveAllowance',
		[lazyTokenId.toSolidityAddress(), fudgedContractId.toSolidityAddress(), amount],
	);

	if (result2[0]?.status?.toString() !== 'SUCCESS') {
		console.log('Failed to approve allowance:', result2);
		fail();
	}
}

// eslint-disable-next-line no-unused-vars
async function revokeLSCTAllowance() {
	const fudgedContractId = AccountId.fromString(contractId.toString());

	let result = await contractExecuteFunction(
		lazySCT,
		lazyIface,
		client,
		950_000,
		'approveAllowance',
		[lazyTokenId.toSolidityAddress(), fudgedContractId.toSolidityAddress(), 0],
	);

	if (result[0]?.status?.toString() !== 'SUCCESS') {
		console.log('Failed to revoke allowance:', result);
		fail();
	}

	// call removeAllowanceWhitelist to remove the desployed swap contract
	result = await contractExecuteFunction(
		lazySCT,
		lazyIface,
		client,
		300_000,
		'removeAllowanceWhitelist',
		[fudgedContractId.toSolidityAddress()],
	);

	if (result[0]?.status?.toString() !== 'SUCCESS') {
		console.log('Failed to remove allowance whitelist:', result);
		fail();
	}
}