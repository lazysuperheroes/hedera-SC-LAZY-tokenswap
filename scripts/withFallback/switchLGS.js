const {
	Client,
	AccountId,
	PrivateKey,
	ContractId,
} = require('@hashgraph/sdk');
require('dotenv').config();
const fs = require('fs');
const { ethers } = require('ethers');
const { getArgFlag, sleep } = require('../../utils/nodeHelpers');
const readlineSync = require('readline-sync');
const { contractExecuteFunction, readOnlyEVMFromMirrorNode } = require('../../utils/solidityHelpers');

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
	// get the command line parameters
	const args = process.argv.slice(2);
	if (args.length != 2 || getArgFlag('h')) {
		console.log('usage: node switchLGS.js 0.0.CCC 0.0.LGS');
		console.log('		CCC is the contractId to update the claim amount');
		console.log('		LGS is the new LazyGasStation contract');
		return;
	}

	const contractId = ContractId.fromString(args[0]);
	const newLGS = ContractId.fromString(args[1]);

	// import ABI
	const json = JSON.parse(fs.readFileSync(`./artifacts/contracts/${contractName}.sol/${contractName}.json`, 'utf8'));
	const nfbtsIface = new ethers.Interface(json.abi);


	console.log('\n-Using ENIVRONMENT:', env);
	console.log('-Using Operator:', operatorId.toString());
	console.log('-Using Contract:', contractId.toString());
	console.log('-New LGS:', newLGS.toString());

	// get the current LGS contract form mirror node
	const encodedCommand = nfbtsIface.encodeFunctionData('lazyGasStation', []);

	let result = await readOnlyEVMFromMirrorNode(
		env,
		contractId,
		encodedCommand,
		operatorId,
		false,
	);

	const currentLGS = nfbtsIface.decodeFunctionResult('lazyGasStation', result);

	console.log('-Current LGS:', ContractId.fromEvmAddress(0, 0, currentLGS.toString()).toString());


	if (env.toUpperCase() == 'TEST') {
		client = Client.forTestnet();
		console.log('testing in *TESTNET*');
	}
	else if (env.toUpperCase() == 'MAIN') {
		client = Client.forMainnet();
		console.log('updating in *MAINNET* #liveAmmo');
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

	const execute = readlineSync.keyInYNStrict('Do wish to update the LGS for the contract?');
	if (!execute) {
		console.log('Aborting, no update to LGS');
		return;
	}

	console.log('Updating the LGS contract for the contract:', execute);

	// call 'updateLGS' on the contract
	result = await contractExecuteFunction(
		contractId,
		nfbtsIface,
		client,
		200_000,
		'updateLGS',
		[newLGS.toSolidityAddress()],
	);

	console.log('Tx:', result[0].status.toString(), 'txId:', result[2].transactionId.toString());

	await sleep(3000);

	// get the current LGS contract form mirror node
	result = await readOnlyEVMFromMirrorNode(
		env,
		contractId,
		encodedCommand,
		operatorId,
		false,
	);

	const updatedLGS = nfbtsIface.decodeFunctionResult('lazyGasStation', result);

	console.log('-Updated LGS:', ContractId.fromEvmAddress(0, 0, updatedLGS.toString()).toString());
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
