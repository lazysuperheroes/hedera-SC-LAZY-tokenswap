const {
	ContractId,
	TokenId,
} = require('@hashgraph/sdk');
const fs = require('fs');
const { ethers } = require('ethers');
const { getArgFlag } = require('../../utils/nodeHelpers.cjs');
const { readOnlyEVMFromMirrorNode } = require('../../utils/solidityHelpers.cjs');
const { contractExecuteFunctionMultiSig, displayMultiSigHelp, shouldDisplayHelp } = require('../../utils/multiSigIntegration.cjs');
const readlineSync = require('readline-sync');
const { estimateGas, logTransactionResult } = require('../../utils/gasHelpers.cjs');
const { initializeClient } = require('../../utils/clientFactory.cjs');

const contractName = 'FallbackTokenSwap';

function showHelp() {
	console.log(`
Usage: node stakeNewTokens.cjs <contract-id> <serials>

Stake NFTs to a FallbackTokenSwap contract for future swaps.

Arguments:
  <contract-id>   Contract ID (e.g., 0.0.123456)
  <serials>       Comma-separated serial numbers to stake (e.g., 1,2,3)

Options:
  -h, --help      Show this help message

Example:
  node stakeNewTokens.cjs 0.0.123456 1,2,3,4,5
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
	if (args.length !== 2) {
		showHelp();
		process.exit(1);
	}

	// Initialize client using clientFactory
	const { client, operatorId, env } = initializeClient();

	const contractId = ContractId.fromString(args[0]);
	const serials = args[1].split(',').map((s) => parseInt(s));

	console.log('\n-Using Contract:', contractId.toString());
	console.log('-Preparing to stake tokens...');
	console.log('-Serials:', serials.join(','));

	const json = JSON.parse(fs.readFileSync(`./artifacts/contracts/${contractName}.sol/${contractName}.json`, 'utf8'));
	const iface = new ethers.Interface(json.abi);

	// get the newTokenId from the contract via mirror node
	const encodedCommand = iface.encodeFunctionData('swapToken', []);

	const result = await readOnlyEVMFromMirrorNode(
		env,
		contractId,
		encodedCommand,
		operatorId,
		false,
	);

	const tokenAddress = iface.decodeFunctionResult('swapToken', result).newTokenId;
	const newToken = TokenId.fromSolidityAddress(tokenAddress[0].slice(2)).toString();

	console.log('-New Token:', newToken);

	const proceed = readlineSync.keyInYNStrict('Do you want to stake the tokens?');
	if (!proceed) {
		console.log('User Aborted');
		process.exit(0);
	}

	console.log('\n-Executing stake...');

	// Use gas estimation
	const fallbackGas = 115_000 * serials.length;
	const gasInfo = await estimateGas(
		env,
		contractId,
		iface,
		operatorId,
		'stakeNFTs',
		[serials],
		fallbackGas,
	);

	const stakeResult = await contractExecuteFunctionMultiSig(
		contractId,
		iface,
		client,
		gasInfo.gasLimit,
		'stakeNFTs',
		[serials],
	);

	logTransactionResult(stakeResult, 'Stake NFTs', gasInfo);
};

main()
	.then(() => {
		process.exit(0);
	})
	.catch(error => {
		console.error('ERROR:', error.message || error);
		process.exit(1);
	});
