const {
	ContractId,
	TokenId,
	ContractFunctionParameters,
} = require('@hashgraph/sdk');
const fs = require('fs');
const readlineSync = require('readline-sync');
const { contractDeployFunction } = require('../../utils/solidityHelpers.cjs');
const { initializeClient } = require('../../utils/clientFactory.cjs');
const { getArgFlag } = require('../../utils/nodeHelpers.cjs');

const lazyGasStationName = 'LazyGasStation';

function showHelp() {
	console.log(`
Usage: node deployLGS.js

Deploy a new LazyGasStation contract.

Required Environment Variables:
  LAZY_SCT_CONTRACT_ID    LAZY SCT (Staking) contract ID
  LAZY_TOKEN_ID           $LAZY token ID

Note: Will abort if LAZY_GAS_STATION_CONTRACT_ID is already set.

Options:
  -h, --help    Show this help message

Example:
  # Set environment variables in .env, then run:
  node deployLGS.js
`);
}

const main = async () => {
	if (getArgFlag('h') || getArgFlag('help')) {
		showHelp();
		process.exit(0);
	}

	// Initialize client using clientFactory
	const { client } = initializeClient();

	if (!process.env.LAZY_SCT_CONTRACT_ID || !process.env.LAZY_TOKEN_ID) {
		console.error('ERROR: Must specify LAZY_SCT_CONTRACT_ID and LAZY_TOKEN_ID in .env');
		process.exit(1);
	}

	const lazySCT = ContractId.fromString(process.env.LAZY_SCT_CONTRACT_ID);
	const lazyTokenId = TokenId.fromString(process.env.LAZY_TOKEN_ID);

	console.log('\n-Using existing LAZY SCT:', lazySCT.toString());
	console.log('-Using existing LAZY Token ID:', lazyTokenId.toString());

	const lazyGasStationJSON = JSON.parse(
		fs.readFileSync(
			`./artifacts/contracts/${lazyGasStationName}.sol/${lazyGasStationName}.json`,
		),
	);

	if (process.env.LAZY_GAS_STATION_CONTRACT_ID) {
		console.log('\n-Found existing Lazy Gas Station:', process.env.LAZY_GAS_STATION_CONTRACT_ID);
		console.log('Aborting...');
		process.exit(0);
	}

	console.log('LAZY_GAS_STATION_CONTRACT_ID ->', process.env.LAZY_GAS_STATION_CONTRACT_ID);
	const proceed = readlineSync.keyInYNStrict('No Lazy Gas Station found, do you want to deploy it?');

	if (!proceed) {
		console.log('Aborting');
		process.exit(0);
	}

	const gasLimit = 1_500_000;
	console.log('\n- Deploying contract...', lazyGasStationName, '\n\tgas@', gasLimit);

	const lazyGasStationBytecode = lazyGasStationJSON.bytecode;

	const lazyGasStationParams = new ContractFunctionParameters()
		.addAddress(lazyTokenId.toSolidityAddress())
		.addAddress(lazySCT.toSolidityAddress());

	const [lazyGasStationId] = await contractDeployFunction(
		client,
		lazyGasStationBytecode,
		gasLimit,
		lazyGasStationParams,
	);

	console.log(`Lazy Gas Station contract created with ID: ${lazyGasStationId} / ${lazyGasStationId.toSolidityAddress()}`);
};

main()
	.then(() => process.exit(0))
	.catch(error => {
		console.error('ERROR:', error.message || error);
		process.exit(1);
	});
