const {
	AccountId,
	ContractFunctionParameters,
	TokenId,
} = require('@hashgraph/sdk');
const fs = require('fs');
const readlineSync = require('readline-sync');
const { contractDeployFunction } = require('../../utils/solidityHelpers.cjs');
const { initializeClient } = require('../../utils/clientFactory.cjs');
const { getArgFlag } = require('../../utils/nodeHelpers.cjs');

const contractName = 'FallbackTokenSwap';

function showHelp() {
	console.log(`
Usage: node deployFallbackTokenSwap.js

Deploy a new FallbackTokenSwap contract with LazyGasStation support.

Required Environment Variables:
  SWAP_TOKEN                    Token ID for the new swap token
  TOKEN_TREASURY                Account ID of the token treasury
  LAZY_GAS_STATION_CONTRACT_ID  LazyGasStation contract ID
  LAZY_TOKEN_ID                 $LAZY token ID

Options:
  -h, --help    Show this help message

Example:
  # Set environment variables in .env, then run:
  node deployFallbackTokenSwap.js
`);
}

const main = async () => {
	if (getArgFlag('h') || getArgFlag('help')) {
		showHelp();
		process.exit(0);
	}

	// Initialize client using clientFactory
	const { client } = initializeClient();

	const newToken = TokenId.fromString(process.env.SWAP_TOKEN);
	const tokenTreasury = AccountId.fromString(process.env.TOKEN_TREASURY);
	const lazyGasStation = AccountId.fromString(process.env.LAZY_GAS_STATION_CONTRACT_ID);
	const lazyToken = TokenId.fromString(process.env.LAZY_TOKEN_ID);

	console.log('\n-Deploying Contract:', contractName);
	console.log('-Using LazyGasStation:', lazyGasStation.toString());
	console.log('-Using LazyToken:', lazyToken.toString());
	console.log('-Using New Token:', newToken.toString());
	console.log('-Using Old Token Treasury:', tokenTreasury.toString());

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
	} else {
		console.log('Aborting deployment');
	}
};

main()
	.then(() => process.exit(0))
	.catch(error => {
		console.error('ERROR:', error.message || error);
		process.exit(1);
	});
