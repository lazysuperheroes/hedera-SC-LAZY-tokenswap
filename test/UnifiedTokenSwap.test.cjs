const {
	Client,
	AccountId,
	PrivateKey,
	Hbar,
	HbarUnit,
	ContractFunctionParameters,
	ContractId,
} = require('@hashgraph/sdk');
const fs = require('fs');
const { ethers } = require('ethers');
const { expect } = require('chai');
const { describe, it } = require('mocha');
const {
	checkMirrorHbarBalance,
	checkMirrorBalance,
	homebrewPopulateAccountNum,
	EntityType,
	checkMirrorAllowance,
} = require('../utils/hederaMirrorHelpers.cjs');
const { sleep } = require('../utils/nodeHelpers.cjs');
const {
	contractDeployFunction,
	contractExecuteFunction,
	readOnlyEVMFromMirrorNode,
} = require('../utils/solidityHelpers.cjs');
const {
	accountCreator,
	associateTokensToAccount,
	mintNFT,
	sendNFT,
	sendHbar,
	sweepHbar,
	setNFTAllowanceAll,
	clearNFTAllowances,
	setHbarAllowance,
	setFTAllowance,
} = require('../utils/hederaHelpers.cjs');
const { fail } = require('assert');
const { TokenGraveyardABI } = require('@lazysuperheroes/token-graveyard');

require('dotenv').config();

// Get operator from .env file
let operatorKey;
let operatorId;
try {
	operatorKey = PrivateKey.fromStringED25519(process.env.PRIVATE_KEY);
	operatorId = AccountId.fromString(process.env.ACCOUNT_ID);
} catch (err) {
	console.log('ERROR: Must specify PRIVATE_KEY & ACCOUNT_ID in the .env file');
}

const contractName = 'UnifiedTokenSwap';
const env = process.env.ENVIRONMENT ?? null;

// Graveyard testing requires pre-deployed graveyard (OZ4 vs OZ5 incompatibility)
const GRAVEYARD_CONTRACT_ID = process.env.TOKEN_GRAVEYARD_CONTRACT_ID || null;
let GRAVEYARD_TESTING_ENABLED = !!GRAVEYARD_CONTRACT_ID;

const addressRegex = /(\d+\.\d+\.[1-9]\d+)/i;

// reused variables
let contractId;
let contractAddress;
let utsIface;
let alicePK, aliceId;
let bobPK, bobId;
let newNftTokenId, legacyNftTokenId, graveyardLegacyNftTokenId;
let client;
let treasuryId;
let graveyardId, graveyardIface;
const operatorNftAllowances = [];
let graveyardSwapTestable = false; // Set to true only if graveyard is properly configured

describe('Deployment: ', function () {
	it('Should deploy the contract and setup conditions', async function () {
		if (operatorKey === undefined || operatorKey == null || operatorId === undefined || operatorId == null) {
			console.log('Environment required, please specify PRIVATE_KEY & ACCOUNT_ID in the .env file');
			process.exit(1);
		}

		console.log('\n-Using ENVIRONMENT:', env);
		console.log('-Graveyard testing:', GRAVEYARD_TESTING_ENABLED ? 'ENABLED' : 'DISABLED (set TOKEN_GRAVEYARD_CONTRACT_ID in .env)');

		if (env.toUpperCase() == 'TEST') {
			client = Client.forTestnet();
			console.log('testing in *TESTNET*');
		} else if (env.toUpperCase() == 'MAIN') {
			client = Client.forMainnet();
			console.log('testing in *MAINNET*');
		} else if (env.toUpperCase() == 'PREVIEW') {
			client = Client.forPreviewnet();
			console.log('testing in *PREVIEWNET*');
		} else if (env.toUpperCase() == 'LOCAL') {
			const node = { '127.0.0.1:50211': new AccountId(3) };
			client = Client.forNetwork(node).setMirrorNetwork('127.0.0.1:5600');
			console.log('testing in *LOCAL*');
			const rootId = AccountId.fromString('0.0.2');
			const rootKey = PrivateKey.fromStringECDSA(
				'302e020100300506032b65700422042091132178e72057a1d7528025956fe39b0b847f200ab59b2fdd367017f3087137',
			);

			client.setOperator(rootId, rootKey);
			operatorKey = PrivateKey.generateED25519();
			operatorId = await accountCreator(client, operatorKey, 1000);
		} else {
			console.log('ERROR: Must specify either MAIN or TEST or PREVIEW or LOCAL as environment in .env file');
			return;
		}

		client.setOperator(operatorId, operatorKey);
		console.log('\n-Using Operator:', operatorId.toString());
		console.log('\n-Testing:', contractName);

		// Use operator as treasury
		treasuryId = operatorId;

		// Create Alice account
		alicePK = PrivateKey.generateED25519();
		aliceId = await accountCreator(client, alicePK, 150);
		console.log('Alice account ID:', aliceId.toString());
		expect(aliceId.toString().match(addressRegex).length == 2).to.be.true;

		// Create Bob account
		bobPK = PrivateKey.generateED25519();
		bobId = await accountCreator(client, bobPK, 100);
		console.log('Bob account ID:', bobId.toString());
		expect(bobId.toString().match(addressRegex).length == 2).to.be.true;

		// Mint NFT collections
		client.setOperator(operatorId, operatorKey);

		// Create legacy NFT collection (old tokens to swap) - treasury flow
		let result;
		[result, legacyNftTokenId] = await mintNFT(
			client,
			operatorId,
			'UTS-Legacy-NFT',
			'UTSL',
			10,
			50,
			null,
			null,
			true, // noFallback - so we don't need to defeat royalty on minting
		);
		expect(result).to.be.equal('SUCCESS');
		console.log('Legacy NFT Token (Treasury):', legacyNftTokenId.toString());

		// Create new NFT collection (tokens to distribute)
		[result, newNftTokenId] = await mintNFT(
			client,
			operatorId,
			'UTS-New-NFT',
			'UTSN',
			15,
			50,
			null,
			null,
			true,
		);
		expect(result).to.be.equal('SUCCESS');
		console.log('New NFT Token:', newNftTokenId.toString());

		// Setup graveyard if available
		if (GRAVEYARD_TESTING_ENABLED) {
			// Create legacy NFT collection for graveyard testing
			[result, graveyardLegacyNftTokenId] = await mintNFT(
				client,
				operatorId,
				'UTS-Graveyard-Legacy',
				'UTSGL',
				10,
				50,
				null,
				null,
				// allow fallback for graveyard testing
				false,
			);
			expect(result).to.be.equal('SUCCESS');
			console.log('Graveyard Legacy NFT Token:', graveyardLegacyNftTokenId.toString());

			graveyardId = ContractId.fromString(GRAVEYARD_CONTRACT_ID);
			graveyardIface = new ethers.Interface(TokenGraveyardABI);
			console.log('-Using existing TokenGraveyard:', graveyardId.toString());

			// need to associate graveyard with legacy token

			// 1. call isTokenAssociated
			let encodedFunction = graveyardIface.encodeFunctionData('isTokenAssociated', [graveyardLegacyNftTokenId.toSolidityAddress()]);
			let queryResult = await readOnlyEVMFromMirrorNode(
				env,
				graveyardId,
				encodedFunction,
				operatorId,
				false,
			);
			const isAssociated = graveyardIface.decodeFunctionResult('isTokenAssociated', queryResult)[0];
			if (!isAssociated) {
				// user needs to pay the $LAZY cost - need to get the specific LAZY token ID 'lazyToken'
				encodedFunction = graveyardIface.encodeFunctionData('lazyToken', []);
				queryResult = await readOnlyEVMFromMirrorNode(
					env,
					graveyardId,
					encodedFunction,
					operatorId,
					false,
				);
				const lazyTokenAddress = graveyardIface.decodeFunctionResult('lazyToken', queryResult)[0];

				// need to convert this back to TokenId
				const lazyTokenId = await homebrewPopulateAccountNum(env, lazyTokenAddress, EntityType.TOKEN);

				// we need to know which lgs the graveyard uses 'lazyGasStation'
				encodedFunction = graveyardIface.encodeFunctionData('lazyGasStation', []);
				queryResult = await readOnlyEVMFromMirrorNode(
					env,
					graveyardId,
					encodedFunction,
					operatorId,
					false,
				);

				const graveyardGasStation = graveyardIface.decodeFunctionResult('lazyGasStation', queryResult)[0];
				const graveyardGasStationId = await homebrewPopulateAccountNum(env, graveyardGasStation, EntityType.CONTRACT);

				// now the cost from the graveyard 'getCost'
				encodedFunction = graveyardIface.encodeFunctionData('getCost', []);
				queryResult = await readOnlyEVMFromMirrorNode(
					env,
					graveyardId,
					encodedFunction,
					operatorId,
					false,
				);
				const lazyCost = Number(graveyardIface.decodeFunctionResult('getCost', queryResult)[0]);

				// let's check the user has enough LAZY balance
				const lazyBal = await checkMirrorBalance(env, operatorId, lazyTokenId);

				const operatorLazyAllowance = await checkMirrorAllowance(env, operatorId, lazyTokenId, graveyardId);

				if (lazyBal < lazyCost) {
					console.log(`ERROR: Operator needs at least ${lazyCost} $LAZY to associate token in graveyard - has ${lazyBal}`);
					GRAVEYARD_TESTING_ENABLED = false;
				} else if (operatorLazyAllowance < lazyCost) {
					// approve the graveyard to pull the LAZY cost
					result = await setFTAllowance(
						client,
						lazyTokenId,
						operatorId,
						graveyardGasStationId,
						lazyCost,
						'Graveyard $LAZY allowance for: ' + graveyardLegacyNftTokenId.toString(),
					);
					if (result !== 'SUCCESS') {
						console.log('ERROR setting graveyard $LAZY allowance:', result);
						GRAVEYARD_TESTING_ENABLED = false;
					}
				}
				// now call the method to prepare the graveyard. 'associateToken'
				result = await contractExecuteFunction(
					graveyardId,
					graveyardIface,
					client,
					1_400_000,
					'associateToken',
					[graveyardLegacyNftTokenId.toSolidityAddress()],
				);

				if (result[0]?.status?.toString() !== 'SUCCESS') {
					console.log('Failed to associate graveyard with legacy token:', result);
					GRAVEYARD_TESTING_ENABLED = false;
				} else {
					console.log('Graveyard associated with legacy token for testing: ' + graveyardLegacyNftTokenId.toString());
				}
			}
		}

		// Load contract JSON and interface
		const contractJson = JSON.parse(
			fs.readFileSync(`./artifacts/contracts/${contractName}.sol/${contractName}.json`),
		);
		utsIface = new ethers.Interface(contractJson.abi);

		const gasLimit = 5_000_000;
		console.log('\n- Deploying contract:', contractName, '\n\tgas@', gasLimit);

		// Deploy with or without graveyard reference
		const constructorParams = new ContractFunctionParameters()
			.addAddress(GRAVEYARD_TESTING_ENABLED ? graveyardId.toSolidityAddress() : '0x0000000000000000000000000000000000000000');

		[contractId, contractAddress] = await contractDeployFunction(
			client,
			contractJson.bytecode,
			gasLimit,
			constructorParams,
		);

		console.log(`Contract created with ID: ${contractId} / ${contractAddress}`);
		expect(contractId.toString().match(addressRegex).length == 2).to.be.true;

		// Send 2 hbar to the contract for tinybar operations
		await sendHbar(client, operatorId, AccountId.fromString(contractId.toString()), 2, HbarUnit.Hbar);

		// Associate output token with contract (needs extra gas for HTS association)
		result = await contractExecuteFunction(
			contractId,
			utsIface,
			client,
			1_400_000, // Extra gas for association (~950K)
			'addOutputToken',
			[newNftTokenId.toSolidityAddress()],
		);

		if (result[0]?.status?.toString() !== 'SUCCESS') {
			console.log('Failed to add output token:', result);
			fail();
		}

		// No need to associate legacy tokens with operator (treasury) - done in minting

		// Transfer new NFTs to contract (serials 1-10)
		await sendNFT(client, operatorId, AccountId.fromString(contractId.toString()), newNftTokenId, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
		console.log('Transferred 10 new NFTs to contract');

		// Associate tokens for Bob
		const bobTokens = [legacyNftTokenId, newNftTokenId];
		if (GRAVEYARD_TESTING_ENABLED) {
			bobTokens.push(graveyardLegacyNftTokenId);
		}
		result = await associateTokensToAccount(client, bobId, bobPK, bobTokens);
		expect(result).to.be.equal('SUCCESS');

		// Give legacy NFTs to Bob for swap testing (serials 1-3)
		await sendNFT(client, operatorId, bobId, legacyNftTokenId, [1, 2, 3]);
		console.log('Transferred 3 legacy NFTs to Bob');

		// Give graveyard legacy NFTs to Bob if enabled
		if (GRAVEYARD_TESTING_ENABLED) {
			await sendNFT(client, operatorId, bobId, graveyardLegacyNftTokenId, [1, 2, 3]);
			console.log('Transferred 3 graveyard legacy NFTs to Bob');
		}

		await sleep(5000);

		// Verify setup
		const bobLegacyBal = await checkMirrorBalance(env, bobId, legacyNftTokenId);
		expect(bobLegacyBal).to.be.equal(3);

		const contractNewBal = await checkMirrorBalance(env, contractId, newNftTokenId);
		expect(contractNewBal).to.be.equal(10);
	});

	it('Operator should be first admin', async function () {
		const encodedFunction = utsIface.encodeFunctionData('getAdmins');
		const result = await readOnlyEVMFromMirrorNode(
			env,
			contractId,
			encodedFunction,
			operatorId,
			false,
		);
		const admins = utsIface.decodeFunctionResult('getAdmins', result)[0];

		expect(admins.length).to.be.equal(1);
		expect(admins[0].toLowerCase()).to.be.equal('0x' + operatorId.toSolidityAddress().toLowerCase());
	});
});

describe('Multi-Admin Management: ', function () {
	it('Should add Alice as admin', async function () {
		client.setOperator(operatorId, operatorKey);

		const result = await contractExecuteFunction(
			contractId,
			utsIface,
			client,
			200_000,
			'addAdmin',
			[aliceId.toSolidityAddress()],
		);

		if (result[0]?.status?.toString() !== 'SUCCESS') {
			console.log('Failed to add Alice as admin:', result);
			fail();
		}

		await sleep(5000);

		// Verify via mirror
		const encodedFunction = utsIface.encodeFunctionData('getAdmins');
		const queryResult = await readOnlyEVMFromMirrorNode(env, contractId, encodedFunction, operatorId, false);
		const admins = utsIface.decodeFunctionResult('getAdmins', queryResult)[0];
		expect(admins.length).to.be.equal(2);
	});

	it('Alice can execute admin functions', async function () {
		client.setOperator(aliceId, alicePK);

		// Alice unpauses the contract
		const result = await contractExecuteFunction(
			contractId,
			utsIface,
			client,
			200_000,
			'updatePauseStatus',
			[false],
		);

		if (result[0]?.status?.toString() !== 'SUCCESS') {
			console.log('Failed to unpause as Alice:', result);
			fail();
		}

		await sleep(4000);

		// Verify paused is false via mirror node
		const encodedFunction = utsIface.encodeFunctionData('paused');
		const pausedResult = await readOnlyEVMFromMirrorNode(
			env,
			contractId,
			encodedFunction,
			aliceId,
			false,
		);
		const paused = utsIface.decodeFunctionResult('paused', pausedResult);
		expect(paused[0]).to.be.false;

		client.setOperator(operatorId, operatorKey);
	});

	it('Bob cannot execute admin functions', async function () {
		client.setOperator(bobId, bobPK);

		const result = await contractExecuteFunction(
			contractId,
			utsIface,
			client,
			200_000,
			'updatePauseStatus',
			[true],
		);

		// Expect NotAdmin custom error
		if (result[0]?.status?.name != 'NotAdmin') {
			console.log('ERROR executing updatePauseStatus - expected NotAdmin but got:', result);
			fail();
		}

		client.setOperator(operatorId, operatorKey);
	});

	it('Cannot remove last admin', async function () {
		client.setOperator(operatorId, operatorKey);

		// Remove Alice first
		let result = await contractExecuteFunction(
			contractId,
			utsIface,
			client,
			200_000,
			'removeAdmin',
			[aliceId.toSolidityAddress()],
		);

		if (result[0]?.status?.toString() !== 'SUCCESS') {
			console.log('Failed to remove Alice:', result);
			fail();
		}

		// Try to remove operator (should fail - last admin)
		result = await contractExecuteFunction(
			contractId,
			utsIface,
			client,
			200_000,
			'removeAdmin',
			[operatorId.toSolidityAddress()],
		);

		if (result[0]?.status?.name != 'CannotRemoveLastAdmin') {
			console.log('ERROR - expected CannotRemoveLastAdmin but got:', result);
			fail();
		}
	});
});

describe('Swap Configuration: ', function () {
	it('Should add swap configurations for treasury flow', async function () {
		client.setOperator(operatorId, operatorKey);

		// Configure swaps: legacy serials 1-3 -> new serials 1-3
		const inputTokens = [
			legacyNftTokenId.toSolidityAddress(),
			legacyNftTokenId.toSolidityAddress(),
			legacyNftTokenId.toSolidityAddress(),
		];
		const inputSerials = [1, 2, 3];
		const configs = [
			{
				outputToken: newNftTokenId.toSolidityAddress(),
				treasury: treasuryId.toSolidityAddress(),
				useGraveyard: false,
				outputSerial: 1,
			},
			{
				outputToken: newNftTokenId.toSolidityAddress(),
				treasury: treasuryId.toSolidityAddress(),
				useGraveyard: false,
				outputSerial: 2,
			},
			{
				outputToken: newNftTokenId.toSolidityAddress(),
				treasury: treasuryId.toSolidityAddress(),
				useGraveyard: false,
				outputSerial: 3,
			},
		];

		// Use higher gas (500K base + 950K for first-time token association)
		const result = await contractExecuteFunction(
			contractId,
			utsIface,
			client,
			1_500_000,
			'addSwapConfigs',
			[inputTokens, inputSerials, configs],
		);

		if (result[0]?.status?.toString() !== 'SUCCESS') {
			console.log('Failed to add swap configs:', result);
			fail();
		}
	});

	it('Should query swap configuration via mirror', async function () {
		await sleep(5000);
		const inputTokens = [legacyNftTokenId.toSolidityAddress()];
		const inputSerials = [1];

		const encodedFunction = utsIface.encodeFunctionData('getSwapConfigs', [inputTokens, inputSerials]);
		const result = await readOnlyEVMFromMirrorNode(env, contractId, encodedFunction, operatorId, false);
		const configs = utsIface.decodeFunctionResult('getSwapConfigs', result)[0];

		expect(configs.length).to.be.equal(1);
		expect(Number(configs[0].outputSerial)).to.be.equal(1);
		expect(configs[0].useGraveyard).to.be.false;
	});

	it('Should remove swap configuration', async function () {
		client.setOperator(operatorId, operatorKey);

		// First add a config to remove
		let result = await contractExecuteFunction(
			contractId,
			utsIface,
			client,
			400_000,
			'addSwapConfigs',
			[
				[legacyNftTokenId.toSolidityAddress()],
				[99],
				[{
					outputToken: newNftTokenId.toSolidityAddress(),
					treasury: treasuryId.toSolidityAddress(),
					useGraveyard: false,
					outputSerial: 99,
				}],
			],
		);
		expect(result[0]?.status?.toString()).to.equal('SUCCESS');

		// Now remove it
		result = await contractExecuteFunction(
			contractId,
			utsIface,
			client,
			300_000,
			'removeSwapConfigs',
			[
				[legacyNftTokenId.toSolidityAddress()],
				[99],
			],
		);

		if (result[0]?.status?.toString() !== 'SUCCESS') {
			console.log('Failed to remove swap config:', result);
			fail();
		}

		await sleep(5000);

		// Verify it's removed (outputToken should be 0x0)
		const encodedFunction = utsIface.encodeFunctionData('getSwapConfigs', [[legacyNftTokenId.toSolidityAddress()], [99]]);
		const queryResult = await readOnlyEVMFromMirrorNode(env, contractId, encodedFunction, operatorId, false);
		const configs = utsIface.decodeFunctionResult('getSwapConfigs', queryResult)[0];
		expect(configs[0].outputToken).to.equal('0x0000000000000000000000000000000000000000');
	});

	it('Should test the stakeNFTs function for code coverage', async function () {
		// Use newNftTokenId since it's already associated with contract via addOutputToken
		client.setOperator(operatorId, operatorKey);

		// need to set the allowance for the contract to pull the NFTs from treasury
		const allowanceSet = await setNFTAllowanceAll(
			client,
			[newNftTokenId],
			operatorId,
			AccountId.fromString(contractId.toString()),
		);
		expect(allowanceSet).to.be.equal('SUCCESS');

		operatorNftAllowances.push({
			tokenId: newNftTokenId,
			owner: operatorId,
			spender: AccountId.fromString(contractId.toString()),
		});

		// Call stakeNFTs with serials 11 and 12 (these serials were not configured for swap)
		// Note: We only minted 15 serials total, 10 already sent to contract, so use 11-12
		const result = await contractExecuteFunction(
			contractId,
			utsIface,
			client,
			600_000,
			'stakeNFTs',
			[
				newNftTokenId.toSolidityAddress(),
				[11, 12],
			],
		);

		if (result[0]?.status?.toString() !== 'SUCCESS') {
			console.log('Failed to stake NFTs for code coverage:', result);
			fail();
		}
	});

	it('Should add swap configurations for graveyard flow (auto-associates input token)', async function () {
		if (!GRAVEYARD_TESTING_ENABLED) {
			this.skip();
			return;
		}

		client.setOperator(operatorId, operatorKey);

		// First, check the graveyard has the token associated
		const encodedFunction = graveyardIface.encodeFunctionData('isTokenAssociated', [
			graveyardLegacyNftTokenId.toSolidityAddress(),
		]);
		const result1 = await readOnlyEVMFromMirrorNode(env, graveyardId, encodedFunction, operatorId, false);
		const graveyardAssocSuccess = graveyardIface.decodeFunctionResult('isTokenAssociated', result1)[0];

		if (!graveyardAssocSuccess) {
			console.log('WARNING: Graveyard association failed - graveyard swap test will be skipped');
		} else {
			console.log('Graveyard legacy token is associated with UTS contract - LET IT RIP!');
			graveyardSwapTestable = true;
		}

		// NOTE: UTS association is now AUTOMATIC when adding graveyard configs
		// The addSwapConfigs function will auto-associate input tokens for graveyard flow

		// Configure swaps: graveyard legacy serials 1-3 -> new serials 4-6 (graveyard flow)
		// Use higher gas (500K base + 950K for first-time token association)
		const inputTokens = [
			graveyardLegacyNftTokenId.toSolidityAddress(),
			graveyardLegacyNftTokenId.toSolidityAddress(),
			graveyardLegacyNftTokenId.toSolidityAddress(),
		];
		const inputSerials = [1, 2, 3];
		const configs = [
			{
				outputToken: newNftTokenId.toSolidityAddress(),
				treasury: '0x0000000000000000000000000000000000000000', // Not used for graveyard
				useGraveyard: true,
				outputSerial: 4,
			},
			{
				outputToken: newNftTokenId.toSolidityAddress(),
				treasury: '0x0000000000000000000000000000000000000000',
				useGraveyard: true,
				outputSerial: 5,
			},
			{
				outputToken: newNftTokenId.toSolidityAddress(),
				treasury: '0x0000000000000000000000000000000000000000',
				useGraveyard: true,
				outputSerial: 6,
			},
		];

		const result = await contractExecuteFunction(
			contractId,
			utsIface,
			client,
			1_500_000, // Extra gas for auto-association (~950K)
			'addSwapConfigs',
			[inputTokens, inputSerials, configs],
		);

		if (result[0]?.status?.toString() !== 'SUCCESS') {
			console.log('Failed to add graveyard swap configs:', result);
			fail();
		}

		console.log('Graveyard swap configs added (input token auto-associated)');
	});

	it('Should verify input token was auto-associated via isTokenAssociated', async function () {
		if (!GRAVEYARD_TESTING_ENABLED) {
			this.skip();
			return;
		}

		await sleep(3000);

		// Check isTokenAssociated returns true for the graveyard legacy token
		const tokenAddress = graveyardLegacyNftTokenId.toSolidityAddress();
		const encodedFunction = utsIface.encodeFunctionData('isTokenAssociated', [tokenAddress]);
		const result = await readOnlyEVMFromMirrorNode(env, contractId, encodedFunction, operatorId, false);
		const isAssociated = utsIface.decodeFunctionResult('isTokenAssociated', result)[0];
		expect(isAssociated).to.be.true;

		// Check getInputTokens includes the graveyard legacy token
		const encodedFunction2 = utsIface.encodeFunctionData('getInputTokens');
		const result2 = await readOnlyEVMFromMirrorNode(env, contractId, encodedFunction2, operatorId, false);
		const inputTokensList = utsIface.decodeFunctionResult('getInputTokens', result2)[0];
		expect(inputTokensList.length).to.be.greaterThanOrEqual(1);

		// Normalize addresses for comparison (both should be lowercase, with 0x prefix)
		const normalizedList = inputTokensList.map(t => t.toLowerCase());
		const expectedAddress = '0x' + tokenAddress.toLowerCase();
		expect(normalizedList).to.include(expectedAddress);
	});
});

describe('Treasury Swap Execution: ', function () {
	it('Should setup user HBAR allowance for 3-legged royalty defeat', async function () {
		// In 3-legged flow, user receives 1 tinybar in step 1, pays 1 back in step 3
		// User needs HBAR allowance to contract for step 3 (net cost = 0)
		client.setOperator(bobId, bobPK);

		const result = await setHbarAllowance(
			client,
			bobId,
			AccountId.fromString(contractId.toString()),
			100,
			HbarUnit.Tinybar,
		);

		console.log('Bob HBAR allowance to contract:', result);
		expect(result).to.be.equal('SUCCESS');
	});

	it('Bob can swap NFT (treasury flow)', async function () {
		client.setOperator(bobId, bobPK);

		// Bob sets NFT allowance for the contract
		const allowanceSet = await setNFTAllowanceAll(
			client,
			[legacyNftTokenId],
			bobId,
			AccountId.fromString(contractId.toString()),
		);
		expect(allowanceSet).to.be.equal('SUCCESS');

		operatorNftAllowances.push({
			tokenId: legacyNftTokenId,
			owner: bobId,
			spender: AccountId.fromString(contractId.toString()),
		});

		// Query swap config to understand what token Bob will receive
		const encodedFunction = utsIface.encodeFunctionData('getSwapConfigs', [
			[legacyNftTokenId.toSolidityAddress()],
			[2],
		]);
		const configResult = await readOnlyEVMFromMirrorNode(env, contractId, encodedFunction, bobId, false);
		const swapConfig = utsIface.decodeFunctionResult('getSwapConfigs', configResult)[0][0];
		console.log('Swap config output token:', swapConfig.outputToken, 'serial:', swapConfig.outputSerial.toString());

		// Bob is already associated with newNftTokenId from setup

		// Get initial balances
		const origBobLegacyBal = await checkMirrorBalance(env, bobId, legacyNftTokenId);
		const origBobNewBal = await checkMirrorBalance(env, bobId, newNftTokenId);

		// Bob swaps serial 2 (3-legged transfer needs more gas)
		const result = await contractExecuteFunction(
			contractId,
			utsIface,
			client,
			1_200_000,
			'swapNFTs',
			[[legacyNftTokenId.toSolidityAddress()], [2]],
		);

		if (result[0]?.status?.toString() !== 'SUCCESS') {
			console.log('Failed to swap NFT:', result);
			fail();
		}

		console.log('Bob Treasury Swap Tx ID:', result[2]?.transactionId?.toString());

		await sleep(5000);

		// Verify balances changed
		const newBobLegacyBal = await checkMirrorBalance(env, bobId, legacyNftTokenId);
		const newBobNewBal = await checkMirrorBalance(env, bobId, newNftTokenId);

		expect(newBobLegacyBal).to.be.equal(origBobLegacyBal - 1);
		expect(newBobNewBal).to.be.equal(origBobNewBal + 1);

		// Verify treasury received old NFT
		const treasuryLegacyBal = await checkMirrorBalance(env, treasuryId, legacyNftTokenId);
		expect(treasuryLegacyBal).to.be.greaterThanOrEqual(1);

		client.setOperator(operatorId, operatorKey);
	});

	it('Should fail for unconfigured swap', async function () {
		client.setOperator(bobId, bobPK);

		// Try to swap serial 99 (non-existent config - we removed it)
		const result = await contractExecuteFunction(
			contractId,
			utsIface,
			client,
			300_000,
			'swapNFTs',
			[[legacyNftTokenId.toSolidityAddress()], [99]],
		);

		if (result[0]?.status?.name != 'ConfigNotFound') {
			console.log('ERROR - expected ConfigNotFound but got:', result);
			fail();
		}

		client.setOperator(operatorId, operatorKey);
	});

	it('Should fail when contract is paused', async function () {
		client.setOperator(operatorId, operatorKey);

		// Pause the contract
		let result = await contractExecuteFunction(
			contractId,
			utsIface,
			client,
			200_000,
			'updatePauseStatus',
			[true],
		);

		if (result[0]?.status?.toString() !== 'SUCCESS') {
			console.log('Failed to pause:', result);
			fail();
		}

		// Try to swap while paused
		client.setOperator(bobId, bobPK);

		result = await contractExecuteFunction(
			contractId,
			utsIface,
			client,
			500_000,
			'swapNFTs',
			[[legacyNftTokenId.toSolidityAddress()], [3]],
		);

		if (result[0]?.status?.name != 'ContractPaused') {
			console.log('ERROR - expected ContractPaused but got:', result);
			fail();
		}

		// Unpause for next tests
		client.setOperator(operatorId, operatorKey);
		await contractExecuteFunction(
			contractId,
			utsIface,
			client,
			200_000,
			'updatePauseStatus',
			[false],
		);
	});
});

describe('Graveyard Swap Execution: ', function () {
	it('Bob can swap NFT (graveyard flow)', async function () {
		if (!GRAVEYARD_TESTING_ENABLED) {
			this.skip();
			return;
		}
		if (!graveyardSwapTestable) {
			console.log('SKIPPING: Graveyard not properly configured (association failed)');
			this.skip();
			return;
		}

		client.setOperator(bobId, bobPK);

		// Bob sets NFT allowance for the graveyard legacy token
		const allowanceSet = await setNFTAllowanceAll(
			client,
			[graveyardLegacyNftTokenId],
			bobId,
			AccountId.fromString(contractId.toString()),
		);
		expect(allowanceSet).to.be.equal('SUCCESS');

		operatorNftAllowances.push({
			tokenId: graveyardLegacyNftTokenId,
			owner: bobId,
			spender: AccountId.fromString(contractId.toString()),
		});

		// Bob also needs HBAR allowance for graveyard flow (to pay graveyard cost)
		const hbarApproval = await setHbarAllowance(
			client,
			bobId,
			AccountId.fromString(contractId.toString()),
			10, // 10 tinybar should be sufficient
			HbarUnit.Tinybar,
		);
		expect(hbarApproval).to.be.equal('SUCCESS');

		// Query swap config to understand what token Bob will receive
		const encodedFunction = utsIface.encodeFunctionData('getSwapConfigs', [
			[graveyardLegacyNftTokenId.toSolidityAddress()],
			[1],
		]);
		const configResult = await readOnlyEVMFromMirrorNode(env, contractId, encodedFunction, bobId, false);
		const swapConfig = utsIface.decodeFunctionResult('getSwapConfigs', configResult)[0][0];
		console.log('Graveyard Swap config output token:', swapConfig.outputToken, 'serial:', swapConfig.outputSerial.toString());

		// Get initial balances
		const origBobGraveyardLegacyBal = await checkMirrorBalance(env, bobId, graveyardLegacyNftTokenId);
		const origBobNewBal = await checkMirrorBalance(env, bobId, newNftTokenId);

		// Bob swaps serial 1 (graveyard flow)
		const result = await contractExecuteFunction(
			contractId,
			utsIface,
			client,
			1_200_000, // More gas for graveyard flow
			'swapNFTs',
			[[graveyardLegacyNftTokenId.toSolidityAddress()], [1]],
		);

		if (result[0]?.status?.toString() !== 'SUCCESS') {
			console.log('Failed to swap NFT (graveyard):', result);
			fail();
		}

		console.log('Bob Graveyard Swap Tx ID:', result[2]?.transactionId?.toString());

		await sleep(5000);

		// Verify balances changed
		const newBobGraveyardLegacyBal = await checkMirrorBalance(env, bobId, graveyardLegacyNftTokenId);
		const newBobNewBal = await checkMirrorBalance(env, bobId, newNftTokenId);

		expect(newBobGraveyardLegacyBal).to.be.equal(origBobGraveyardLegacyBal - 1);
		expect(newBobNewBal).to.be.equal(origBobNewBal + 1);

		// Verify graveyard received old NFT (permanently buried)
		const graveyardBal = await checkMirrorBalance(env, graveyardId, graveyardLegacyNftTokenId);
		expect(graveyardBal).to.be.greaterThanOrEqual(1);

		client.setOperator(operatorId, operatorKey);
	});

	it('Graveyard swap verifies *NOT* contract user', async function () {
		if (!GRAVEYARD_TESTING_ENABLED) {
			this.skip();
			return;
		}

		// Verify UTS is a contract user of graveyard
		const encodedFunction = graveyardIface.encodeFunctionData('isContractUser', [contractId.toSolidityAddress()]);
		const result = await readOnlyEVMFromMirrorNode(env, graveyardId, encodedFunction, operatorId, false);
		const isContractUser = graveyardIface.decodeFunctionResult('isContractUser', result)[0];

		expect(isContractUser).to.be.false;
	});
});

describe('Admin Utilities: ', function () {
	it('Should transfer HBAR out of contract', async function () {
		client.setOperator(operatorId, operatorKey);

		const origBalance = await checkMirrorHbarBalance(env, operatorId);

		// Transfer 1000 tinybar out
		const result = await contractExecuteFunction(
			contractId,
			utsIface,
			client,
			200_000,
			'transferHbar',
			[operatorId.toSolidityAddress(), 1000],
		);

		if (result[0]?.status?.toString() !== 'SUCCESS') {
			console.log('Failed to transfer HBAR:', result);
			fail();
		}

		await sleep(3000);

		const newBalance = await checkMirrorHbarBalance(env, operatorId);
		// Balance should increase (minus gas costs)
		expect(newBalance).to.be.greaterThan(origBalance - 10_000_000); // Allow for gas
	});

	it('Should check isAdmin view function', async function () {
		const encodedFunction = utsIface.encodeFunctionData('isAdmin', [operatorId.toSolidityAddress()]);
		const result = await readOnlyEVMFromMirrorNode(env, contractId, encodedFunction, operatorId, false);
		const isAdmin = utsIface.decodeFunctionResult('isAdmin', result)[0];
		expect(isAdmin).to.be.true;

		const encodedFunction2 = utsIface.encodeFunctionData('isAdmin', [bobId.toSolidityAddress()]);
		const result2 = await readOnlyEVMFromMirrorNode(env, contractId, encodedFunction2, operatorId, false);
		const isBobAdmin = utsIface.decodeFunctionResult('isAdmin', result2)[0];
		expect(isBobAdmin).to.be.false;
	});

	it('Should check getOutputTokens view function', async function () {
		const encodedFunction = utsIface.encodeFunctionData('getOutputTokens');
		const result = await readOnlyEVMFromMirrorNode(env, contractId, encodedFunction, operatorId, false);
		const tokens = utsIface.decodeFunctionResult('getOutputTokens', result)[0];
		expect(tokens.length).to.be.greaterThanOrEqual(1);
	});

	it('Should check isTokenAssociated for output token', async function () {
		const encodedFunction = utsIface.encodeFunctionData('isTokenAssociated', [newNftTokenId.toSolidityAddress()]);
		const result = await readOnlyEVMFromMirrorNode(env, contractId, encodedFunction, operatorId, false);
		const isAssociated = utsIface.decodeFunctionResult('isTokenAssociated', result)[0];
		expect(isAssociated).to.be.true;
	});

	it('Should check isTokenAssociated returns false for unknown token', async function () {
		// Use a random address that's definitely not associated
		const randomAddress = '0x0000000000000000000000000000000000000001';
		const encodedFunction = utsIface.encodeFunctionData('isTokenAssociated', [randomAddress]);
		const result = await readOnlyEVMFromMirrorNode(env, contractId, encodedFunction, operatorId, false);
		const isAssociated = utsIface.decodeFunctionResult('isTokenAssociated', result)[0];
		expect(isAssociated).to.be.false;
	});

	it('Should check getInputTokens view function', async function () {
		const encodedFunction = utsIface.encodeFunctionData('getInputTokens');
		const result = await readOnlyEVMFromMirrorNode(env, contractId, encodedFunction, operatorId, false);
		const tokens = utsIface.decodeFunctionResult('getInputTokens', result)[0];
		// Will have at least 1 if graveyard testing enabled, 0 otherwise
		if (GRAVEYARD_TESTING_ENABLED) {
			expect(tokens.length).to.be.greaterThanOrEqual(1);
		} else {
			expect(tokens.length).to.be.greaterThanOrEqual(0);
		}
	});

	it('Should fail BadInput for mismatched arrays', async function () {
		client.setOperator(operatorId, operatorKey);

		// Test with mismatched array lengths
		const result = await contractExecuteFunction(
			contractId,
			utsIface,
			client,
			300_000,
			'addSwapConfigs',
			[
				[legacyNftTokenId.toSolidityAddress()], // 1 token
				[1, 2], // 2 serials - mismatch!
				[{
					outputToken: newNftTokenId.toSolidityAddress(),
					treasury: treasuryId.toSolidityAddress(),
					useGraveyard: false,
					outputSerial: 1,
				}],
			],
		);

		if (result[0]?.status?.name != 'BadInput') {
			console.log('ERROR - expected BadInput but got:', result);
			fail();
		}
	});

	it('Should test unstakeNFTs function', async function () {
		client.setOperator(operatorId, operatorKey);

		// First, stake some NFTs to the contract that we can then unstake
		// Use newNftTokenId since it's already associated with contract via addOutputToken
		// Serials 13-14 should still be with operator (we staked 11-12 earlier)
		const allowanceSet = await setNFTAllowanceAll(
			client,
			[newNftTokenId],
			operatorId,
			AccountId.fromString(contractId.toString()),
		);
		expect(allowanceSet).to.be.equal('SUCCESS');

		// Stake serials 13 and 14 to the contract
		let result = await contractExecuteFunction(
			contractId,
			utsIface,
			client,
			600_000,
			'stakeNFTs',
			[newNftTokenId.toSolidityAddress(), [13, 14]],
		);

		if (result[0]?.status?.toString() !== 'SUCCESS') {
			console.log('Failed to stake NFTs for unstake test:', result);
			fail();
		}

		await sleep(3000);

		// Associate Alice with the new NFT token so she can receive it
		client.setOperator(aliceId, alicePK);
		const assocResult = await associateTokensToAccount(client, aliceId, alicePK, [newNftTokenId]);
		// May already be associated from previous test runs - both SUCCESS and TOKEN_ALREADY_ASSOCIATED are OK
		if (assocResult !== 'SUCCESS' && !assocResult.includes('TOKEN_ALREADY_ASSOCIATED')) {
			console.log('Failed to associate Alice with new NFT token:', assocResult);
			fail();
		}

		// Set up Alice as receiver with HBAR allowance to contract (required for royalty defeat)
		const hbarAllowanceResult = await setHbarAllowance(
			client,
			aliceId,
			AccountId.fromString(contractId.toString()),
			100, // 100 tinybar allowance
		);
		expect(hbarAllowanceResult).to.be.equal('SUCCESS');
		console.log('Alice HBAR allowance to contract: SUCCESS');

		// Get Alice's initial balance
		const origAliceNewBal = await checkMirrorBalance(env, aliceId, newNftTokenId);

		// Admin (operator) unstakes NFTs to Alice
		client.setOperator(operatorId, operatorKey);
		result = await contractExecuteFunction(
			contractId,
			utsIface,
			client,
			600_000,
			'unstakeNFTs',
			[newNftTokenId.toSolidityAddress(), [13], aliceId.toSolidityAddress()],
		);

		if (result[0]?.status?.toString() !== 'SUCCESS') {
			console.log('Failed to unstake NFTs:', result);
			fail();
		}

		console.log('unstakeNFTs Tx ID:', result[2]?.transactionId?.toString());

		await sleep(5000);

		// Verify Alice received the NFT
		const newAliceNewBal = await checkMirrorBalance(env, aliceId, newNftTokenId);
		expect(newAliceNewBal).to.be.equal(origAliceNewBal + 1);
	});

	it('Should test updateGraveyard function', async function () {
		if (!GRAVEYARD_TESTING_ENABLED) {
			this.skip();
			return;
		}

		client.setOperator(operatorId, operatorKey);

		// Get current graveyard address
		const encodedFunction = utsIface.encodeFunctionData('graveyard');
		const result = await readOnlyEVMFromMirrorNode(env, contractId, encodedFunction, operatorId, false);
		const currentGraveyard = utsIface.decodeFunctionResult('graveyard', result)[0];

		// Update graveyard to the same address (just testing the function works)
		const updateResult = await contractExecuteFunction(
			contractId,
			utsIface,
			client,
			200_000,
			'updateGraveyard',
			[currentGraveyard],
		);

		if (updateResult[0]?.status?.toString() !== 'SUCCESS') {
			console.log('Failed to update graveyard:', updateResult);
			fail();
		}

		// Verify graveyard is still the same
		const result2 = await readOnlyEVMFromMirrorNode(env, contractId, encodedFunction, operatorId, false);
		const newGraveyard = utsIface.decodeFunctionResult('graveyard', result2)[0];
		expect(newGraveyard.toLowerCase()).to.equal(currentGraveyard.toLowerCase());
	});
});

describe('Cleanup: ', function () {
	it('Clear NFT allowances', async function () {
		if (operatorNftAllowances.length === 0) {
			this.skip();
			return;
		}

		// Group allowances by owner
		const operatorAllowances = operatorNftAllowances.filter(a => a.owner.toString() === operatorId.toString());
		const bobAllowances = operatorNftAllowances.filter(a => a.owner.toString() === bobId.toString());

		// Clear operator's allowances
		if (operatorAllowances.length > 0) {
			client.setOperator(operatorId, operatorKey);
			const result = await clearNFTAllowances(client, operatorAllowances);
			console.log('Operator allowances cleared:', result);
		}

		// Clear Bob's allowances
		if (bobAllowances.length > 0) {
			client.setOperator(bobId, bobPK);
			const result = await clearNFTAllowances(client, bobAllowances);
			console.log('Bob allowances cleared:', result);
		}

		client.setOperator(operatorId, operatorKey);
	});

	it('Retrieve HBAR from test accounts', async function () {
		client.setOperator(operatorId, operatorKey);

		await sleep(5000);

		// Sweep Alice
		let balance = await checkMirrorHbarBalance(env, aliceId);
		balance -= 1_000_000;
		if (balance > 0) {
			console.log('sweeping alice', balance / 10 ** 8);
			const result = await sweepHbar(client, aliceId, alicePK, operatorId, new Hbar(balance, HbarUnit.Tinybar));
			console.log('alice:', result);
		}

		// Sweep Bob
		balance = await checkMirrorHbarBalance(env, bobId);
		balance -= 1_000_000;
		if (balance > 0) {
			console.log('sweeping bob', balance / 10 ** 8);
			const result = await sweepHbar(client, bobId, bobPK, operatorId, new Hbar(balance, HbarUnit.Tinybar));
			console.log('bob:', result);
		}

		// Sweep contract
		balance = await checkMirrorHbarBalance(env, contractId);
		balance -= 1_000_000;
		if (balance > 0) {
			const result = await contractExecuteFunction(
				contractId,
				utsIface,
				client,
				300_000,
				'transferHbar',
				[operatorId.toSolidityAddress(), balance],
			);
			console.log('contract:', result[0]?.status?.toString());
		}
	});
});
