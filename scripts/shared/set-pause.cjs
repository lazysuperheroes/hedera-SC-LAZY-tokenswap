/**
 * Unified pause/unpause script for TokenSwap contracts
 *
 * Usage:
 *   node set-pause.js --pause 0.0.CONTRACT_ID [--fallback]
 *   node set-pause.js --unpause 0.0.CONTRACT_ID [--fallback]
 *
 * Options:
 *   --pause      Pause the contract
 *   --unpause    Unpause the contract
 *   --fallback   Use FallbackTokenSwap ABI (default: NoFallbackTokenSwap)
 *   -h, --help   Show this help message
 */

const { ContractId } = require('@hashgraph/sdk');
const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');
const { getArgFlag } = require('../../utils/nodeHelpers.cjs');
const { contractExecuteFunctionMultiSig, displayMultiSigHelp, shouldDisplayHelp } = require('../../utils/multiSigIntegration.cjs');
const { initializeClient } = require('../../utils/clientFactory.cjs');

function showHelp() {
	console.log(`
Usage: node set-pause.js [options] <contract-id>

Set the pause status of a TokenSwap contract.

Arguments:
  <contract-id>    Contract ID to pause/unpause (e.g., 0.0.123456)

Options:
  --pause          Pause the contract
  --unpause        Unpause the contract
  --fallback       Use FallbackTokenSwap ABI (default: NoFallbackTokenSwap)
  -h, --help       Show this help message

Multi-Sig Options:
  --multisig       Enable multi-signature mode
  --threshold=N    Require N signatures (default: 2)
  --offline        Use offline signing workflow
  --export-only    Export transaction for offline signing
  --multisig-help  Show detailed multi-sig help

Examples:
  # Pause a NoFallbackTokenSwap contract
  node set-pause.js --pause 0.0.123456

  # Unpause a FallbackTokenSwap contract
  node set-pause.js --unpause 0.0.123456 --fallback

  # Pause with multi-sig (2-of-N threshold)
  node set-pause.js --pause 0.0.123456 --multisig --threshold=2
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

	// Parse arguments
	const args = process.argv.slice(2).filter(arg => !arg.startsWith('-'));
	const shouldPause = getArgFlag('pause');
	const shouldUnpause = getArgFlag('unpause');
	const useFallback = getArgFlag('fallback');

	// Validate arguments
	if (args.length !== 1) {
		console.error('ERROR: Contract ID is required');
		console.error('');
		showHelp();
		process.exit(1);
	}

	if (shouldPause && shouldUnpause) {
		console.error('ERROR: Cannot use both --pause and --unpause');
		process.exit(1);
	}

	if (!shouldPause && !shouldUnpause) {
		console.error('ERROR: Must specify either --pause or --unpause');
		console.error('');
		showHelp();
		process.exit(1);
	}

	// Initialize client
	const { client } = initializeClient();

	// Parse contract ID
	let contractId;
	try {
		contractId = ContractId.fromString(args[0]);
	} catch (err) {
		console.error(`ERROR: Invalid contract ID format: ${args[0]}`);
		console.error('Expected format: 0.0.XXXXX');
		process.exit(1);
	}

	// Determine contract type
	const contractName = useFallback ? 'FallbackTokenSwap' : 'NoFallbackTokenSwap';
	const pauseValue = shouldPause;
	const action = shouldPause ? 'Pausing' : 'Unpausing';

	console.log(`\n-${action} Contract:`, contractName);
	console.log('-Contract ID:', contractId.toString());

	// Load ABI
	const abiPath = path.join(
		process.cwd(),
		'artifacts',
		'contracts',
		`${contractName}.sol`,
		`${contractName}.json`,
	);

	if (!fs.existsSync(abiPath)) {
		console.error(`ERROR: ABI file not found at ${abiPath}`);
		console.error('Run "npx hardhat compile" first');
		process.exit(1);
	}

	const json = JSON.parse(fs.readFileSync(abiPath, 'utf8'));
	const iface = new ethers.Interface(json.abi);

	// Execute pause/unpause (supports multi-sig if --multisig flag present)
	console.log(`\n-Executing updatePauseStatus(${pauseValue})...`);

	const result = await contractExecuteFunctionMultiSig(
		contractId,
		iface,
		client,
		null,
		'updatePauseStatus',
		[pauseValue],
	);

	const status = result[0]?.status?.toString();
	const txId = result[2]?.transactionId?.toString();

	if (status === 'SUCCESS') {
		console.log(`\n✅ Contract ${shouldPause ? 'paused' : 'unpaused'} successfully`);
		console.log(`   Transaction ID: ${txId}`);
	} else {
		console.error(`\n❌ Operation failed: ${status}`);
		console.error(`   Transaction ID: ${txId}`);
		process.exit(1);
	}
};

main()
	.then(() => process.exit(0))
	.catch(error => {
		console.error('ERROR:', error.message || error);
		process.exit(1);
	});
