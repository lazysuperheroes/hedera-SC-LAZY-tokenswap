const {
	ContractCreateFlow,
	ContractId,
} = require('@hashgraph/sdk');
const fs = require('fs');
const { getArgFlag, getArg } = require('../../utils/nodeHelpers.cjs');
const { initializeClient } = require('../../utils/clientFactory.cjs');

const contractName = 'UnifiedTokenSwap';

function showHelp() {
	console.log(`
Usage: node deployUnifiedTokenSwap.js [options]

Deploy a new UnifiedTokenSwap contract to the Hedera network.

Options:
  -h, --help              Show this help message
  --graveyard <id>        Token Graveyard contract ID (e.g., 0.0.123456)
                          Optional - set to 0.0.0 or omit if not using graveyard
  --gas <amount>          Gas limit for deployment (default: 5000000)
  --json                  Output result as JSON (for automation)

Environment Variables:
  ACCOUNT_ID              Hedera operator account
  PRIVATE_KEY             Operator private key
  ENVIRONMENT             Network (TEST, MAIN, PREVIEW, LOCAL)

Example:
  node deployUnifiedTokenSwap.js --graveyard 0.0.123456
  node deployUnifiedTokenSwap.js --graveyard 0.0.0 --gas 6000000
`);
}

const main = async () => {
	if (getArgFlag('h') || getArgFlag('help')) {
		showHelp();
		process.exit(0);
	}

	const jsonOutput = getArgFlag('json');
	const { client, operatorId, env } = initializeClient();

	if (!jsonOutput) {
		console.log(`\n-Using ENVIRONMENT: ${env}`);
		console.log(`-Using Operator: ${operatorId}`);
	}

	// Parse arguments
	const graveyardArg = getArg('graveyard');
	let graveyardAddress = '0x0000000000000000000000000000000000000000';

	if (graveyardArg && graveyardArg !== '0.0.0') {
		const graveyardId = ContractId.fromString(graveyardArg);
		graveyardAddress = graveyardId.toSolidityAddress();
		if (!jsonOutput) console.log(`-Using Graveyard: ${graveyardArg} (${graveyardAddress})`);
	} else {
		if (!jsonOutput) console.log('-Graveyard: Not configured (can be set later)');
	}

	const gasLimit = Number(getArg('gas')) || 5_000_000;
	if (!jsonOutput) console.log(`-Gas Limit: ${gasLimit.toLocaleString()}`);

	// Load contract bytecode
	const contractJson = JSON.parse(
		fs.readFileSync(
			`./artifacts/contracts/${contractName}.sol/${contractName}.json`,
		),
	);

	const contractBytecode = contractJson.bytecode;

	if (!contractBytecode || contractBytecode === '0x') {
		console.error('ERROR: Contract bytecode not found. Run "npx hardhat compile" first.');
		process.exit(1);
	}

	if (!jsonOutput) console.log(`\n- Deploying contract: ${contractName}`);

	// Deploy contract
	const contractCreateTx = new ContractCreateFlow()
		.setBytecode(contractBytecode)
		.setGas(gasLimit)
		.setConstructorParameters(
			new (require('@hashgraph/sdk').ContractFunctionParameters)()
				.addAddress(graveyardAddress),
		);

	const contractCreateSubmit = await contractCreateTx.execute(client);
	const contractCreateRx = await contractCreateSubmit.getReceipt(client);
	const contractId = contractCreateRx.contractId;

	if (jsonOutput) {
		console.log(JSON.stringify({
			success: true,
			contractId: contractId.toString(),
			evmAddress: contractId.toSolidityAddress(),
			operator: operatorId.toString(),
			graveyard: graveyardArg || null,
			environment: env,
		}));
	} else {
		console.log('\n=== Deployment Complete ===');
		console.log(`Contract ID: ${contractId}`);
		console.log(`EVM Address: ${contractId.toSolidityAddress()}`);
		console.log(`\nDeployer (${operatorId}) is now the first admin.`);

		if (graveyardAddress === '0x0000000000000000000000000000000000000000') {
			console.log('\nNote: Graveyard not configured. To use graveyard features:');
			console.log('  1. Deploy or locate a Token Graveyard contract');
			console.log('  2. Run: node adminManagement.js --contract <id> --set-graveyard <graveyard-id>');
			console.log('  3. Register this contract as ContractUser on the graveyard');
		}

		console.log('\nNext steps:');
		console.log('  1. Add output tokens: node setupSwapConfig.js --contract <id> --add-token <token-id>');
		console.log('  2. Configure swaps: node setupSwapConfig.js --contract <id> --add-swap ...');
		console.log('  3. Unpause: node adminManagement.js --contract <id> --unpause');
	}

	client.close();
};

main()
	.then(() => process.exit(0))
	.catch((error) => {
		console.error('ERROR:', error.message || error);
		process.exit(1);
	});
