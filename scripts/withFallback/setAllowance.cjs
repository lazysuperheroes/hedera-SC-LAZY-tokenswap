const {
	AccountId,
	ContractId,
	TokenId,
} = require('@hashgraph/sdk');
const readlineSync = require('readline-sync');
const { getArgFlag } = require('../../utils/nodeHelpers.cjs');
const { getTokenDetails } = require('../../utils/hederaMirrorHelpers.cjs');
const { setFTAllowance } = require('../../utils/hederaHelpers.cjs');
const { initializeClient } = require('../../utils/clientFactory.cjs');

function showHelp() {
	console.log(`
Usage: node setAllowance.js <contract-id> <token-id> <amount>

Set a fungible token allowance for a contract to spend on behalf of the operator.

Arguments:
  <contract-id>    Contract ID to grant allowance to (e.g., 0.0.123456)
  <token-id>       Fungible token ID (e.g., 0.0.789)
  <amount>         Allowance amount (before decimal adjustment)

Options:
  -h, --help    Show this help message

Example:
  node setAllowance.js 0.0.123456 0.0.789 1000

  Grants contract 0.0.123456 permission to spend 1000 tokens (adjusted for decimals)
`);
}

async function main() {
	const args = process.argv.slice(2).filter(arg => !arg.startsWith('-'));

	if (args.length != 3 || getArgFlag('h') || getArgFlag('help')) {
		showHelp();
		process.exit(args.length === 3 ? 0 : 1);
	}

	// Initialize client using clientFactory
	const { client, operatorId, env } = initializeClient();

	const contractId = ContractId.fromString(args[0]);
	const tokenId = TokenId.fromString(args[1]);
	const amount = Number(args[2]);

	// Get token detail from the mirror node
	const tokenDets = await getTokenDetails(env, tokenId);
	if (tokenDets == null) {
		console.error('ERROR: Token not found');
		process.exit(1);
	}

	if (tokenDets.type == 'NON_FUNGIBLE_UNIQUE') {
		console.error('ERROR: Script designed for FT not NFT');
		process.exit(1);
	}

	const tokenDecimal = tokenDets.decimals;
	console.log('Setting allowance for', contractId.toString(), 'to spend', tokenId.toString(), 'for', amount, 'on behalf of', operatorId.toString());
	console.log('Token has', tokenDecimal, 'decimals');
	console.log('Amount to set:', amount * Math.pow(10, tokenDecimal));

	const execute = readlineSync.keyInYNStrict('Do wish to set allowance?');

	if (execute) {
		console.log('\n- Setting allowance...');
		const allowanceSet = await setFTAllowance(
			client,
			tokenId,
			operatorId,
			AccountId.fromString(contractId.toString()),
			amount * Math.pow(10, tokenDecimal),
		);

		console.log('Allowance set:', allowanceSet);
	} else {
		console.log('Aborting allowance set');
	}
}

main()
	.then(() => process.exit(0))
	.catch(error => {
		console.error('ERROR:', error.message || error);
		process.exit(1);
	});
