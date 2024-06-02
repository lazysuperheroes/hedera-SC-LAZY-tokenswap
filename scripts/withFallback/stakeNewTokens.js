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
const { contractExecuteFunction, readOnlyEVMFromMirrorNode } = require('../../utils/solidityHelpers');
const readlineSync = require('readline-sync');

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
	if (args.length != 3 || getArgFlag('h')) {
		console.log('Usage: stakeNewTokens.js 0.0.CCC X,Y,Z');
		console.log('		CCC is the contractId to update the claim amount');
		console.log('		X,Y,Z are the serials to stake');
		return;
	}

	const contractId = ContractId.fromString(args[0]);
	const serials = args[1].split(',').map((s) => parseInt(s));

	console.log('\n-Using ENIVRONMENT:', env);
	console.log('\n-Using Operator:', operatorId.toString());
	console.log('\n-Using Contract:', contractId.toString());
	console.log('\n-Preparing to stake tokens...');
	console.log('\n-Serials:', serials.join(','));

	const json = JSON.parse(fs.readFileSync(`./artifacts/contracts/${contractName}.sol/${contractName}.json`, 'utf8'));
	const fbtsIface = new ethers.Interface(json.abi);

	// get the newTokenId from the contract vis mirror node
	const encodedCommand = fbtsIface.encodeFunctionData('swapToken', []);

	let result = await readOnlyEVMFromMirrorNode(
		env,
		contractId,
		encodedCommand,
		operatorId,
		false,
	);

	const tokenAddress = fbtsIface.decodeFunctionResult('swapToken', result).newTokenId;

	const newToken = TokenId.fromSolidityAddress(tokenAddress[0].slice(2)).toString();


	console.log('New Token:', newToken.toString());
	// can validate operator owns the tokens...

	const proceed = readlineSync.keyInYNStrict('Do you want to stake the tokens?');
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

	result = await contractExecuteFunction(
		contractId,
		fbtsIface,
		client,
		115_000 * serials.length,
		'stakeNFTs',
		[serials],
	);

	console.log('Tokens staked:', result[0]?.status?.toString(), 'txId:', result[2]?.transactionId?.toString());
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
