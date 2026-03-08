const {
	ContractId,
} = require('@hashgraph/sdk');
const fs = require('fs');
const { ethers } = require('ethers');
const { getArgFlag, sleep } = require('../../utils/nodeHelpers.cjs');
const readlineSync = require('readline-sync');
const { readOnlyEVMFromMirrorNode } = require('../../utils/solidityHelpers.cjs');
const { contractExecuteFunctionMultiSig, displayMultiSigHelp, shouldDisplayHelp } = require('../../utils/multiSigIntegration.cjs');
const { initializeClient } = require('../../utils/clientFactory.cjs');

const contractName = 'FallbackTokenSwap';

function showHelp() {
	console.log(`
Usage: node switchLGS.cjs <contract-id> <new-lgs-id>

Update the LazyGasStation reference on a FallbackTokenSwap contract.

Arguments:
  <contract-id>    FallbackTokenSwap contract ID (e.g., 0.0.123456)
  <new-lgs-id>     New LazyGasStation contract ID (e.g., 0.0.789)

Options:
  -h, --help    Show this help message

Example:
  node switchLGS.cjs 0.0.123456 0.0.789

  Updates contract 0.0.123456 to use LazyGasStation 0.0.789
`);
}

const main = async () => {
	// Check for help flags
	if (getArgFlag('h') || getArgFlag('help')) {
		showHelp();
		process.exit(0);
	}

	if (shouldDisplayHelp()) {
		displayMultiSigHelp();
		process.exit(0);
	}

	const args = process.argv.slice(2).filter(arg => !arg.startsWith('-'));

	if (args.length != 2) {
		showHelp();
		process.exit(1);
	}

	// Initialize client using clientFactory
	const { client, operatorId, env } = initializeClient();

	const contractId = ContractId.fromString(args[0]);
	const newLGS = ContractId.fromString(args[1]);

	// Import ABI
	const json = JSON.parse(fs.readFileSync(`./artifacts/contracts/${contractName}.sol/${contractName}.json`, 'utf8'));
	const nfbtsIface = new ethers.Interface(json.abi);

	console.log('\n-Using Contract:', contractId.toString());
	console.log('-New LGS:', newLGS.toString());

	// Get the current LGS contract from mirror node
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

	const execute = readlineSync.keyInYNStrict('Do wish to update the LGS for the contract?');
	if (!execute) {
		console.log('Aborting, no update to LGS');
		process.exit(0);
	}

	console.log('Updating the LGS contract...');

	// Call 'updateLGS' on the contract
	result = await contractExecuteFunctionMultiSig(
		contractId,
		nfbtsIface,
		client,
		200_000,
		'updateLGS',
		[newLGS.toSolidityAddress()],
	);

	console.log('Tx:', result[0]?.status?.toString(), 'txId:', result[2]?.transactionId?.toString());

	await sleep(3000);

	// Get the updated LGS contract from mirror node
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
	.then(() => process.exit(0))
	.catch(error => {
		console.error('ERROR:', error.message || error);
		process.exit(1);
	});
