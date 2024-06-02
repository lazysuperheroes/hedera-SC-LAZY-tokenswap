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

const contractName = 'FallbackTokenSwap';
const env = process.env.ENVIRONMENT ?? null;
let client;

// check-out the deployed script - test read-only method
const main = async () => {
	const args = process.argv.slice(2);
	if (args.length != 2 || getArgFlag('h')) {
		console.log('Usage: prepareForStakedSwap.js 0.0.CCC 0.0.XXX,0.0.YYY');
		console.log('		CCC is the contractId to update the claim amount');
		console.log('		0.0.XXX,0.0.YYY are the tokens to associate to the contract');
	}

	const contractId = ContractId.fromString(args[0]);
	const tokens = args[1].split(',').map((t) => TokenId.fromString(t));
	const tokensAsSolidity = tokens.map((t) => t.toSolidityAddress());


	console.log('\n-Using ENIVRONMENT:', env);
	console.log('\n-Using Operator:', operatorId.toString());
	console.log('\n-Using Contract:', contractId.toString());
	console.log('\n-To handle fall back fees the contract needs to be prepared for staked swap...please ensure tokens are not already associated');
	console.log('\n-Tokens to associate:', tokens.map((t) => t.toString()).join(','));

	// check mirror node is these are associated
	let tokenError = false;
	for (let i = 0; i < tokens.length; i++) {
		const balance = await checkMirrorBalance(env, AccountId.fromString(contractId.toString()), tokens[i]);
		// if balance is null then we are safe to associate, if 0 or a number we are not
		if (balance != null) {
			console.log(`ERROR: Token [${tokens[i].toString()}] already associated to contract`);
			tokenError = true;
		}
	}

	if (tokenError) {
		console.log('Aborting as tokens are already associated to the contract');
		return;
	}

	const proceed = readlineSync.keyInYNStrict('Do you want to pay to associate these to the contract?');
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
		1_000_000 * tokens.length,
		'prepareForStakedSwap',
		[tokensAsSolidity],
	);

	console.log('Tokens associated:', result[0]?.status?.toString(), 'txId:', result[2]?.transactionId?.toString());
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
