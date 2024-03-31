const {
	Client,
	AccountId,
	PrivateKey,
	ContractId,
	TokenId,
} = require('@hashgraph/sdk');
require('dotenv').config();
const fs = require('fs');
const { ethers } = require('ethers');
const { getArgFlag } = require('../../utils/nodeHelpers');
const { contractExecuteFunction } = require('../../utils/solidityHelpers');
const readlineSync = require('readline-sync');
const { setNFTAllowanceAll, associateTokenToAccount } = require('../../utils/hederaHelpers');
const { checkMirrorBalance } = require('../../utils/hederaMirrorHelpers');

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
const env = process.env.ENVIRONMENT ?? null;
const lazyTokenId = TokenId.fromString(process.env.LAZY_TOKEN_ID);
let client;

// check-out the deployed script - test read-only method
const main = async () => {
	const args = process.argv.slice(2);
	if (args.length != 3 || getArgFlag('h')) {
		console.log('Usage: tokenSwap.js 0.0.CCC 0.0.XXX,0.0.YYY X1,X2,X3:Y1,Y2,Y3');
		console.log('		CCC is the contractId to update the claim amount');
		console.log('		0.0.XXX,0.0.YYY are the tokens to swap in same order as the serials');
		console.log('		X,Y,Z are the serials to swap in same order as the tokenIds delimited by :');
		console.log('example: tokenSwap.js 0.0.123 0.0.456,0.0.789 1,2:3,4');
		return;
	}

	const contractId = ContractId.fromString(args[0]);
	const tokens = args[1].split(',').map((t) => TokenId.fromString(t));
	// create and array of arrays
	const serials = args[2].split(':').map((s) => s.split(','));

	if (tokens.length != serials.length) {
		console.log('ERROR: Must have same number of tokens as serials');
		return;
	}

	console.log('\n-Using ENIVRONMENT:', env);
	console.log('\n-Using Operator:', operatorId.toString());
	console.log('\n-Using Contract:', contractId.toString());
	console.log('\n-Preparing to swap tokens...');


	const tokenArg = [];
	const serialArg = [];
	for (let i = 0; i < tokens.length; i++) {
		for (let j = 0; j < serials[i].length; j++) {
			tokenArg.push(tokens[i]);
			serialArg.push(serials[i][j]);
		}
	}

	let proceed = readlineSync.keyInYNStrict('Do you want to set allowances needed for the swap?');
	if (!proceed) {
		console.log('User Aborted');
		return;
	}

	const allowanceStatus = await setNFTAllowanceAll(client, tokens, operatorId, contractId);
	console.log('Allowance Status:', allowanceStatus);

	// check the user has Lazy Associated
	const lazyBalance = await checkMirrorBalance(env, operatorId, lazyTokenId);
	if (lazyBalance == 0) {
		console.log('ERROR: Operator may not have $LAZY associated');

		proceed = readlineSync.keyInYNStrict('Do you want to associate $LAZY?');
		if (proceed) {
			const status = await associateTokenToAccount(
				client,
				operatorId,
				operatorKey,
				lazyTokenId,
			);
			console.log('Associate $LAZY Status:', status);
		}
	}

	proceed = readlineSync.keyInYNStrict('Do you want to swap the tokens?');
	if (!proceed) {
		console.log('User Aborted');
		return;
	}

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
	}
	else {
		console.log(
			'ERROR: Must specify either MAIN or TEST or LOCAL as environment in .env file',
		);
		return;
	}

	client.setOperator(operatorId, operatorKey);

	const json = JSON.parse(fs.readFileSync(`./artifacts/contracts/${contractName}.sol/${contractName}.json`, 'utf8'));
	const nfbtsIface = new ethers.Interface(json.abi);

	const result = await contractExecuteFunction(
		contractId,
		nfbtsIface,
		client,
		250_000 + 75_000 * tokens.length,
		'swapNFTs',
		[tokens, serials],
	);

	console.log('$LAZY Received:', result[1]?.toString());
	console.log('Tokens swapped:', result[0]?.status?.toString(), 'txId:', result[2]?.transactionId?.toString());
};

main()
	.then(() => {
		// eslint-disable-next-line no-useless-escape
		process.exit(0);
	})
	.catch(error => {
		console.error(error);
		process.exit(1);
	});
