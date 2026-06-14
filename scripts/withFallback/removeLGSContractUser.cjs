const {
	ContractId,
} = require('@hashgraph/sdk');
const fs = require('fs');
const { ethers } = require('ethers');
const readlineSync = require('readline-sync');
const { contractExecuteFunctionMultiSig, displayMultiSigHelp, shouldDisplayHelp } = require('../../utils/multiSigIntegration.cjs');
const { initializeClient } = require('../../utils/clientFactory.cjs');
const { getArgFlag, getArg } = require('../../utils/nodeHelpers.cjs');

const lazyGasStationName = 'LazyGasStation';

function showHelp() {
	console.log(`
Usage: node removeLGSContractUser.cjs --contracts 0.0.x,0.0.y,0.0.z [--yes]

Remove one or more contract users from the LazyGasStation.

Required Environment Variables:
  LAZY_GAS_STATION_CONTRACT_ID    LazyGasStation contract ID

Options:
  --contracts <ids>   Comma-separated contract IDs to remove (else prompted)
  --yes               Skip the confirmation prompt
  -h, --help          Show this help message

Note: requires the operator to be an Admin or Authorizer on the LazyGasStation.
      removeContractUser is idempotent — removing an address that is not a
      contract user simply returns false and does not revert.

Example:
  node removeLGSContractUser.cjs --contracts 0.0.7540226,0.0.8049115,0.0.8051127
`);
}

const main = async () => {
	if (getArgFlag('h') || getArgFlag('help')) {
		showHelp();
		process.exit(0);
	}

	if (shouldDisplayHelp()) {
		displayMultiSigHelp();
		process.exit(0);
	}

	if (!process.env.LAZY_GAS_STATION_CONTRACT_ID) {
		console.error('ERROR: No Lazy Gas Station found -> check LAZY_GAS_STATION_CONTRACT_ID');
		process.exit(1);
	}

	const { client } = initializeClient();

	const lazyGasStationJSON = JSON.parse(
		fs.readFileSync(
			`./artifacts/contracts/${lazyGasStationName}.sol/${lazyGasStationName}.json`,
		),
	);
	const lazyGasStationIface = new ethers.Interface(lazyGasStationJSON.abi);

	const lazyGasStationId = ContractId.fromString(process.env.LAZY_GAS_STATION_CONTRACT_ID);
	console.log('\n-Using existing Lazy Gas Station:', lazyGasStationId.toString());

	// Gather the contract IDs to remove (CLI --contracts or interactive prompt)
	const raw = getArg('contracts')
		|| readlineSync.question('Enter contract ID(s) to remove (comma-separated): ');

	const addressRegex = /^\d+\.\d+\.[1-9]\d*$/;
	const ids = raw.split(',').map(s => s.trim()).filter(Boolean);

	if (ids.length === 0) {
		console.error('ERROR: No contract IDs provided');
		process.exit(1);
	}

	const invalid = ids.filter(id => !addressRegex.test(id));
	if (invalid.length > 0) {
		console.error('ERROR: Invalid contract ID(s):', invalid.join(', '));
		process.exit(1);
	}

	console.log('\nWill remove the following contract user(s) from the Lazy Gas Station:');
	ids.forEach(id => console.log(`  - ${id}`));

	if (!getArgFlag('yes')) {
		if (!readlineSync.keyInYN('Proceed?')) {
			console.log('Aborted.');
			process.exit(0);
		}
	}

	let removed = 0;
	for (const id of ids) {
		const contract = ContractId.fromString(id);
		console.log(`\nRemoving ${id}...`);

		const rslt = await contractExecuteFunctionMultiSig(
			lazyGasStationId,
			lazyGasStationIface,
			client,
			null,
			'removeContractUser',
			[contract.toSolidityAddress()],
		);

		const status = rslt[0]?.status?.toString();
		if (status != 'SUCCESS') {
			console.error(`  ERROR removing ${id} from LGS:`, status);
			process.exit(1);
		}

		removed++;
		console.log(`  Removed ${id} — tx: ${rslt[2]?.transactionId?.toString()}`);
	}

	console.log(`\nDone. ${removed}/${ids.length} contract user(s) removed.`);
};

main()
	.then(() => process.exit(0))
	.catch(error => {
		console.error('ERROR:', error.message || error);
		process.exit(1);
	});
