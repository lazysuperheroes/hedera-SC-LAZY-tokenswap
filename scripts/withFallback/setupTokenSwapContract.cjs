const {
	ContractId,
	TokenId,
} = require('@hashgraph/sdk');
const fs = require('fs');
const { ethers } = require('ethers');
const { getArgFlag } = require('../../utils/nodeHelpers.cjs');
const readlineSync = require('readline-sync');
const { contractExecuteFunctionMultiSig, displayMultiSigHelp, shouldDisplayHelp } = require('../../utils/multiSigIntegration.cjs');
const { initializeClient } = require('../../utils/clientFactory.cjs');
const { estimateGas, logTransactionResult } = require('../../utils/gasHelpers.cjs');

const contractName = 'FallbackTokenSwap';
const BATCH = 75;

function showHelp() {
	console.log(`
Usage: node setupTokenSwapContract.js <contract-id> <path/to/file>

Upload swap configuration to a FallbackTokenSwap contract.

Arguments:
  <contract-id>     Contract ID to configure (e.g., 0.0.123456)
  <path/to/file>    CSV file with swap data (token,oldSerial,newSerial per line)

Options:
  -h, --help    Show this help message

CSV Format:
  Each line should be: 0.0.TOKEN_ID,OLD_SERIAL,NEW_SERIAL

Example:
  node setupTokenSwapContract.js 0.0.123456 ./swap-config.csv
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
	const filePath = args[1];

	if (!fs.existsSync(filePath)) {
		console.error(`ERROR: File not found: ${filePath}`);
		process.exit(1);
	}

	let lineNum = 0;
	const allFileContents = fs.readFileSync(filePath, 'utf-8');
	const lines = allFileContents.split(/\r?\n/);

	const newSerialList = [];
	const swapHashList = [];
	const outputList = [];
	for (let l = 0; l < lines.length; l++) {
		const line = lines[l];
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

	console.log('\n-Using Contract:', contractId.toString());
	console.log('-Found config for tokens:', swapHashList.length);

	const proceed = readlineSync.keyInYNStrict('Do you want to display config?');
	if (proceed) {
		for (let i = 0; i < outputList.length; i++) {
			console.log('Token:', outputList[i][0], 'Old Serial:', outputList[i][1], 'New Serial:', outputList[i][2]);
		}
	}

	// Import ABI
	const json = JSON.parse(fs.readFileSync(`./artifacts/contracts/${contractName}.sol/${contractName}.json`, 'utf8'));
	const nfbtsIface = new ethers.Interface(json.abi);

	const execute = readlineSync.keyInYNStrict('Do wish to push config to the contract?');
	if (execute) {
		for (let i = 0; i < newSerialList.length; i += BATCH) {
			const topEnd = i + Math.min(BATCH, newSerialList.length - i);
			const batchSize = topEnd - i;
			console.log(`\nProcessing batch ${i} - ${topEnd - 1} (${batchSize} items)`);

			const batchSerials = newSerialList.slice(i, topEnd);
			const batchHashes = swapHashList.slice(i, topEnd);

			// Estimate gas for this batch
			const fallbackGas = 500_000 + 75_000 * batchSize;
			const gasInfo = await estimateGas(
				env,
				contractId,
				nfbtsIface,
				operatorId,
				'updateSwapConfig',
				[batchSerials, batchHashes],
				fallbackGas,
			);

			const result = await contractExecuteFunctionMultiSig(
				contractId,
				nfbtsIface,
				client,
				gasInfo.gasLimit,
				'updateSwapConfig',
				[batchSerials, batchHashes],
			);

			logTransactionResult(result, `Batch ${i}-${topEnd - 1}`, gasInfo);
		}
	}
};

main()
	.then(() => process.exit(0))
	.catch(error => {
		console.error('ERROR:', error.message || error);
		process.exit(1);
	});
