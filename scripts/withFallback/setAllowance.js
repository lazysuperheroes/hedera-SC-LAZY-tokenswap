const {
	Client,
	AccountId,
	PrivateKey,
	ContractId,
	TokenId,
} = require('@hashgraph/sdk');
const readlineSync = require('readline-sync');
const { getArgFlag } = require('../../utils/nodeHelpers');
const { getTokenDetails } = require('../../utils/hederaMirrorHelpers');
const { setFTAllowance } = require('../../utils/hederaHelpers');
require('dotenv').config();

// Get operator from .env file
let operatorKey;
let operatorId;
let client;
const env = process.env.ENVIRONMENT ?? null;

try {
	operatorKey = PrivateKey.fromStringED25519(process.env.PRIVATE_KEY);
	operatorId = AccountId.fromString(process.env.ACCOUNT_ID);
}
catch (err) {
	console.log('ERROR: Must specify PRIVATE_KEY & ACCOUNT_ID in the .env file');
}

async function main() {
	// configure the client object
	if (
		operatorKey === undefined ||
		operatorKey == null ||
		operatorId === undefined ||
		operatorId == null
	) {
		console.log(
			'Environment required, please specify PRIVATE_KEY & ACCOUNT_ID in the .env file',
		);
		process.exit(1);
	}

	const args = process.argv.slice(2);
	if (args.length != 3 || getArgFlag('h')) {
		console.log('Usage: setAllowance.js 0.0.CCCC 0.0.TTTT amt');
		console.log('		CCCC is the contractId to set an allowance from treasury to');
		console.log('		TTTT is the tokenId (FT) to set the allowance for');
		console.log('		amt is the allowance amount');
		return;
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
	// deploy the contract
	console.log('\n-Using Operator:', operatorId.toString());

	// expect 3 arguments: contractId, tokenId, and amount
	const contractId = ContractId.fromString(args[0]);
	const tokenId = TokenId.fromString(args[1]);
	const amount = Number(args[2]);

	// get token detail from the mirror node
	const tokenDets = await getTokenDetails(env, tokenId);
	if (tokenDets == null) {
		console.log('Token not found');
		return;
	}

	if (tokenDets.type == 'NON_FUNGIBLE_UNIQUE') {
		console.log('Script designed for FT not NFT - exiting');
		return;
	}

	const tokenDecimal = tokenDets.decimals;
	console.log('Setting allowance for', contractId.toString(), 'to spend', tokenId.toString(), 'for', amount, 'on behalf of', operatorId.toString());
	console.log('Token has', tokenDecimal, 'decimals');
	console.log('Amount to set:', amount * Math.pow(10, tokenDecimal));

	const execute = readlineSync.keyInYNStrict('Do wish to set allowance?');

	if (execute) {
		console.log('\n- Setting allowance...');
		const allowanceSet = await setFTAllowance(
			client,
			tokenId,
			operatorId,
			AccountId.fromString(contractId.toString()),
			amount * Math.pow(10, tokenDecimal),
		);

		console.log('Allowance set:', allowanceSet);
	}
	else {
		console.log('Aborting allowance set');
	}
}

main()
	.then(() => process.exit(0))
	.catch(error => {
		console.error(error);
		process.exit(1);
	});