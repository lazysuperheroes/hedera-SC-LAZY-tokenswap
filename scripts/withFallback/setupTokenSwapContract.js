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
const readlineSync = require('readline-sync');
const { contractExecuteFunction } = require('../../utils/solidityHelpers');

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

const BATCH = 75;

const env = process.env.ENVIRONMENT ?? null;
let client;

// check-out the deployed script - test read-only method
const main = async () => {
	// get the command line parameters
	const args = process.argv.slice(2);
	if (args.length != 2 || getArgFlag('h')) {
		console.log('usage: node setupTokenSwapContract.js 0.0.CCC <path/to/file>');
		console.log('		CCC is the contractId to update the claim amount');
		console.log('		The path to the file containing the swap data');
		console.log('		Each line should be in the format: token,oldSerial,newSerial');
		return;
	}

	const contractId = ContractId.fromString(args[0]);

	// read in CSV file names in args[0] and parse each line
	try {
		fs.access(args[1], fs.constants.F_OK, (err) => {
			if (err) {
				console.log(`${args[1]} does not exist`, err);
				return;
			}
		});
	}
	catch (err) {
		console.log(`${args[1]} does not exist`, err);
		return;
	}

	let lineNum = 0;
	const allFileContents = fs.readFileSync(args[1], 'utf-8');
	const lines = allFileContents.split(/\r?\n/);

	const newSerialList = [];
	const swapHashList = [];
	const outputList = [];
	for (let l = 0; l < lines.length; l++) {
		const line = lines[l];
		// discard if headers [i.e. does not start with 0. for wallet ID]
		lineNum++;
		if (!/^0.0.[1-9][0-9]+,/i.test(line)) {
			console.log(`DB: Skipping line ${lineNum} - poorly formed wallet address: ${line}`);
			continue;
		}
		const [token, oldSerial, newSerial] = line.split(',');

		newSerialList.push(Number(newSerial));
		swapHashList.push(ethers.solidityPackedKeccak256(['address', 'uint256'], [TokenId.fromString(token).toSolidityAddress(), Number(oldSerial)]));

		outputList.push([token, oldSerial, newSerial]);
	}


	console.log('\n-Using ENIVRONMENT:', env);
	console.log('\n-Using Operator:', operatorId.toString());
	console.log('\n-Using Contract:', contractId.toString());
	console.log('\n-Found config for tokens:', swapHashList.length);

	const proceed = readlineSync.keyInYNStrict('Do you want to display config?');
	if (proceed) {
		for (let i = 0; i < outputList.length; i++) {
			console.log('Token:', outputList[i][0], 'Old Serial:', outputList[i][1], 'New Serial:', outputList[i][2]);
		}
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

	// import ABI
	const json = JSON.parse(fs.readFileSync(`./artifacts/contracts/${contractName}.sol/${contractName}.json`, 'utf8'));
	const nfbtsIface = new ethers.Interface(json.abi);

	const execute = readlineSync.keyInYNStrict('Do wish to push config to the contract?');
	if (execute) {
		for (let i = 0; i < newSerialList.length; i += BATCH) {
			const topEnd = i + Math.min(BATCH, newSerialList.length - i);
			console.log('Processing batch', i, '-', topEnd - 1);
			const result = await contractExecuteFunction(
				contractId,
				nfbtsIface,
				client,
				500_000 + 75_000 * (topEnd - i),
				'updateSwapConfig',
				[newSerialList.slice(i, topEnd), swapHashList.slice(i, topEnd)],
			);
			console.log('Tx', i, '-', topEnd, ':', result[0].status.toString(), 'txId:', result[2].transactionId.toString());
		}
	}
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
