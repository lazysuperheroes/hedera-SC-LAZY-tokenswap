const {
	ContractId,
} = require('@hashgraph/sdk');
const fs = require('fs');
const { ethers } = require('ethers');
const readlineSync = require('readline-sync');
const { contractExecuteFunctionMultiSig, displayMultiSigHelp, shouldDisplayHelp } = require('../../utils/multiSigIntegration.cjs');
const { initializeClient } = require('../../utils/clientFactory.cjs');
const { getArgFlag } = require('../../utils/nodeHelpers.cjs');

const lazyGasStationName = 'LazyGasStation';

function showHelp() {
	console.log(`
Usage: node setLGSContractUser.cjs

Add a swap contract as an authorized user of the LazyGasStation.

Required Environment Variables:
  LAZY_GAS_STATION_CONTRACT_ID    LazyGasStation contract ID

Options:
  -h, --help    Show this help message

Note: You will be prompted to enter the Swap Contract ID interactively.

Example:
  node setLGSContractUser.cjs
  # Then enter: 0.0.123456
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

	// Initialize client using clientFactory
	const { client } = initializeClient();

	const lazyGasStationJSON = JSON.parse(
		fs.readFileSync(
			`./artifacts/contracts/${lazyGasStationName}.sol/${lazyGasStationName}.json`,
		),
	);

	const lazyGasStationIface = new ethers.Interface(lazyGasStationJSON.abi);

	if (!process.env.LAZY_GAS_STATION_CONTRACT_ID) {
		console.error('ERROR: No Lazy Gas Station found -> check LAZY_GAS_STATION_CONTRACT_ID');
		process.exit(1);
	}

	const lazyGasStationId = ContractId.fromString(process.env.LAZY_GAS_STATION_CONTRACT_ID);
	console.log('\n-Using existing Lazy Gas Station:', lazyGasStationId.toString());

	// Read in the contract to add to LGS on commandline with read-line
	const swapContractId = readlineSync.question('Enter the Swap Contract ID: ');

	const addressRegex = /(\d+\.\d+\.[1-9]\d+)/i;
	if (!addressRegex.test(swapContractId)) {
		console.error('ERROR: Invalid contract ID');
		process.exit(1);
	}

	const swapContract = ContractId.fromString(swapContractId);

	// Add the contract to the lazy gas station as a contract user
	const rslt = await contractExecuteFunctionMultiSig(
		lazyGasStationId,
		lazyGasStationIface,
		client,
		null,
		'addContractUser',
		[swapContract.toSolidityAddress()],
	);

	if (rslt[0]?.status?.toString() != 'SUCCESS') {
		console.error('ERROR adding contract to LGS:', rslt[0]?.status?.toString());
		process.exit(1);
	}

	console.log('Swap contract added to Lazy Gas Station:', rslt[2]?.transactionId?.toString());
};

main()
	.then(() => process.exit(0))
	.catch(error => {
		console.error('ERROR:', error.message || error);
		process.exit(1);
	});
