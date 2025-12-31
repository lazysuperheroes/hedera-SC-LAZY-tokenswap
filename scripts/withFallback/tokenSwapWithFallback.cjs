const {
	ContractId,
	TokenId,
} = require('@hashgraph/sdk');
const fs = require('fs');
const { ethers } = require('ethers');
const { getArgFlag } = require('../../utils/nodeHelpers.cjs');
const { contractExecuteFunctionMultiSig, displayMultiSigHelp, shouldDisplayHelp } = require('../../utils/multiSigIntegration.cjs');
const readlineSync = require('readline-sync');
const { setFTAllowance, setNFTAllowanceAll, associateTokenToAccount } = require('../../utils/hederaHelpers.cjs');
const { checkMirrorBalance, checkMirrorAllowance } = require('../../utils/hederaMirrorHelpers.cjs');
const { estimateGas, logTransactionResult } = require('../../utils/gasHelpers.cjs');
const { initializeClient } = require('../../utils/clientFactory.cjs');

const contractName = 'FallbackTokenSwap';

function showHelp() {
	console.log(`
Usage: node tokenSwapWithFallback.js <contract-id> <tokens> <serials>

Execute a token swap on a FallbackTokenSwap contract.

Arguments:
  <contract-id>   Contract ID (e.g., 0.0.123456)
  <tokens>        Comma-separated token IDs to swap (e.g., 0.0.XXX,0.0.YYY)
  <serials>       Colon-delimited serial groups matching tokens (e.g., 1,2:3,4)

Options:
  -h, --help      Show this help message
  --yes           Skip confirmation prompts (for automation/CI)

Example:
  node tokenSwapWithFallback.js 0.0.123 0.0.456,0.0.789 1,2:3,4

  This swaps serials 1,2 from token 0.0.456 and serials 3,4 from token 0.0.789
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
	if (args.length !== 3) {
		showHelp();
		process.exit(1);
	}

	// Initialize client using clientFactory
	const { client, operatorId, operatorKey, env } = initializeClient();

	const lazyTokenId = TokenId.fromString(process.env.LAZY_TOKEN_ID);
	const contractId = ContractId.fromString(args[0]);
	const tokens = args[1].split(',').map((t) => TokenId.fromString(t));
	const tokenAddresses = tokens.map((t) => t.toSolidityAddress());
	const serials = args[2].split(':').map((s) => (s.split(',')));

	if (tokens.length !== serials.length) {
		console.error('ERROR: Must have same number of tokens as serials');
		process.exit(1);
	}

	// Check for --yes flag to skip prompts
	const skipPrompts = getArgFlag('yes');

	console.log('\n-Using Contract:', contractId.toString());
	console.log('-Preparing to swap tokens...');

	const tokenArg = [];
	const serialArg = [];
	let totalSerials = 0;
	for (let i = 0; i < tokens.length; i++) {
		for (let j = 0; j < serials[i].length; j++) {
			tokenArg.push(tokens[i]);
			serialArg.push(parseInt(serials[i][j]));
			totalSerials++;
		}
	}

	let proceed = skipPrompts || readlineSync.keyInYNStrict('Do you want to set (ALL) allowances needed for the swap?');
	if (!proceed) {
		console.log('User Aborted');
		process.exit(0);
	}

	const allowanceStatus = await setNFTAllowanceAll(client, tokens, operatorId, contractId);
	console.log('NFT Allowance Status:', allowanceStatus);

	// check the user has Lazy Associated
	const lazyBalance = await checkMirrorBalance(env, operatorId, lazyTokenId);
	if (lazyBalance === 0) {
		console.log('WARNING: Operator may not have $LAZY associated');

		proceed = skipPrompts || readlineSync.keyInYNStrict('Do you want to associate $LAZY?');
		if (proceed) {
			const status = await associateTokenToAccount(
				client,
				operatorId,
				operatorKey,
				lazyTokenId,
			);
			console.log('Associate $LAZY Status:', status);
		}
	}

	// user will get some $LAZY when they swap the tokens as part of the initial NFT movement
	// will need to set a $LAZY allowance for the contract to spend on behalf of the operator for the return leg
	const requiredAllowance = Math.ceil(totalSerials / 8);

	// check if they already have an allowance set
	const lazyAllowance = await checkMirrorAllowance(
		env,
		operatorId,
		lazyTokenId,
		contractId,
	);
	if (lazyAllowance < requiredAllowance) {
		console.log('Setting FT allowance for $LAZY:', requiredAllowance);

		const fungibleAllowance = await setFTAllowance(
			client,
			lazyTokenId,
			operatorId,
			contractId,
			requiredAllowance,
		);

		console.log('FT Allowance Status:', fungibleAllowance);
	} else {
		console.log('Operator has sufficient $LAZY allowance');
	}

	proceed = skipPrompts || readlineSync.keyInYNStrict('Do you want to swap the tokens?');
	if (!proceed) {
		console.log('User Aborted');
		process.exit(0);
	}

	const json = JSON.parse(fs.readFileSync(`./artifacts/contracts/${contractName}.sol/${contractName}.json`, 'utf8'));
	const iface = new ethers.Interface(json.abi);

	console.log('\n-Executing swap...');

	// Use gas estimation
	const fallbackGas = 350_000 + 100_000 * tokens.length;
	const gasInfo = await estimateGas(
		env,
		contractId,
		iface,
		operatorId,
		'swapNFTs',
		[tokenAddresses, serialArg],
		fallbackGas,
	);

	const result = await contractExecuteFunctionMultiSig(
		contractId,
		iface,
		client,
		gasInfo.gasLimit,
		'swapNFTs',
		[tokenAddresses, serialArg],
	);

	logTransactionResult(result, 'Token Swap', gasInfo);
	console.log('$LAZY Received:', result[1]?.toString());
};

main()
	.then(() => {
		process.exit(0);
	})
	.catch(error => {
		console.error('ERROR:', error.message || error);
		process.exit(1);
	});
