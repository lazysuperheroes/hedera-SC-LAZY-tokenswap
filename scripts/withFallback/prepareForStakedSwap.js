const {
	AccountId,
	ContractId,
	TokenId,
} = require('@hashgraph/sdk');
const fs = require('fs');
const { ethers } = require('ethers');
const { getArgFlag } = require('../../utils/nodeHelpers');
const { contractExecuteFunction } = require('../../utils/solidityHelpers');
const readlineSync = require('readline-sync');
const { checkMirrorBalance } = require('../../utils/hederaMirrorHelpers');
const { initializeClient } = require('../../utils/clientFactory');

const contractName = 'FallbackTokenSwap';

function showHelp() {
	console.log(`
Usage: node prepareForStakedSwap.js <contract-id> <tokens>

Associate tokens to a FallbackTokenSwap contract for staked swap operations.

Arguments:
  <contract-id>    Contract ID to prepare (e.g., 0.0.123456)
  <tokens>         Comma-separated token IDs to associate (e.g., 0.0.XXX,0.0.YYY)

Options:
  -h, --help    Show this help message

Note: Tokens must not already be associated to the contract.

Example:
  node prepareForStakedSwap.js 0.0.123456 0.0.789,0.0.999

  Associates tokens 0.0.789 and 0.0.999 to contract 0.0.123456
`);
}

const main = async () => {
	const args = process.argv.slice(2).filter(arg => !arg.startsWith('-'));

	if (args.length != 2 || getArgFlag('h') || getArgFlag('help')) {
		showHelp();
		process.exit(args.length === 2 ? 0 : 1);
	}

	// Initialize client using clientFactory
	const { client, operatorId, env } = initializeClient();

	const contractId = ContractId.fromString(args[0]);
	const tokens = args[1].split(',').map((t) => TokenId.fromString(t));
	const tokensAsSolidity = tokens.map((t) => t.toSolidityAddress());

	console.log('\n-Using Contract:', contractId.toString());
	console.log('-To handle fall back fees the contract needs to be prepared for staked swap...please ensure tokens are not already associated');
	console.log('-Tokens to associate:', tokens.map((t) => t.toString()).join(','));

	// Check mirror node if these are associated
	let tokenError = false;
	for (let i = 0; i < tokens.length; i++) {
		const balance = await checkMirrorBalance(env, AccountId.fromString(contractId.toString()), tokens[i]);
		if (balance != null) {
			console.log(`ERROR: Token [${tokens[i].toString()}] already associated to contract`);
			tokenError = true;
		}
	}

	if (tokenError) {
		console.error('Aborting as tokens are already associated to the contract');
		process.exit(1);
	}

	const proceed = readlineSync.keyInYNStrict('Do you want to pay to associate these to the contract?');
	if (!proceed) {
		console.log('User Aborted');
		process.exit(0);
	}

	const json = JSON.parse(fs.readFileSync(`./artifacts/contracts/${contractName}.sol/${contractName}.json`, 'utf8'));
	const nfbtsIface = new ethers.Interface(json.abi);

	const result = await contractExecuteFunction(
		contractId,
		nfbtsIface,
		client,
		1_000_000 * tokens.length,
		'prepareForStakedSwap',
		[tokensAsSolidity],
	);

	console.log('Tokens associated:', result[0]?.status?.toString(), 'txId:', result[2]?.transactionId?.toString());
};

main()
	.then(() => process.exit(0))
	.catch(error => {
		console.error('ERROR:', error.message || error);
		process.exit(1);
	});
