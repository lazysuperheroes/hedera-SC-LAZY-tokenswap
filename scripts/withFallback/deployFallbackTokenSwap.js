const {
	Client,
	AccountId,
	PrivateKey,
	ContractFunctionParameters,
	TokenId,
} = require('@hashgraph/sdk');
const fs = require('fs');
const readlineSync = require('readline-sync');
const { contractDeployFunction } = require('../../utils/solidityHelpers');

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
const contractName = 'FallbackTokenSwap';
const env = process.env.ENVIRONMENT ?? null;

const newToken = TokenId.fromString(process.env.SWAP_TOKEN) ?? null;
const tokenTreasury = AccountId.fromString(process.env.TOKEN_TREASURY) ?? null;
const lazyGasStation = AccountId.fromString(process.env.LAZY_GAS_STATION_CONTRACT_ID) ?? null;
const lazyToken = TokenId.fromString(process.env.LAZY_TOKEN_ID) ?? null;

let client;

const main = async () => {
	if (contractName === undefined || contractName == null) {
		console.log('Environment required, please specify CONTRACT_NAME for ABI in the .env file');
		return;
	}

	console.log('\n-Using ENIVRONMENT:', env);
	console.log('\n-Using Operator:', operatorId.toString());
	console.log('\n-Deploying Contract:', contractName);
	console.log('\n-Using LazyGasStation:', lazyGasStation.toString());
	console.log('\n-Using LazyToken:', lazyToken.toString());
	console.log('\n-Using New Token:', newToken.toString());
	console.log('\n-Using Old Token Treasury:', tokenTreasury.toString());

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

	const json = JSON.parse(fs.readFileSync(`./artifacts/contracts/${contractName}.sol/${contractName}.json`));

	const contractBytecode = json.bytecode;

	const execute = readlineSync.keyInYNStrict('Do wish to deploy?');
	if (execute) {
		console.log('\n- Deploying contract...', contractName);
		const gasLimit = 1_500_000;

		const constructorParams = new ContractFunctionParameters()
			.addAddress(newToken.toSolidityAddress())
			.addAddress(tokenTreasury.toSolidityAddress())
			.addAddress(lazyGasStation.toSolidityAddress())
			.addAddress(lazyToken.toSolidityAddress());

		const [contractId, contractAddress] = await contractDeployFunction(client, contractBytecode, gasLimit, constructorParams);

		console.log(`Contract created with ID: ${contractId} / ${contractAddress}`);
	}
	else {
		console.log('Aborting deployment');
	}

};

main()
	.then(() => process.exit(0))
	.catch(error => {
		console.error(error);
		process.exit(1);
	});
