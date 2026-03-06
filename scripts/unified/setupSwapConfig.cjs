const {
	AccountId,
	ContractId,
	ContractExecuteTransaction,
} = require('@hashgraph/sdk');
const fs = require('fs');
const { ethers } = require('ethers');
const { getArgFlag, getArg } = require('../../utils/nodeHelpers.cjs');
const { initializeClient } = require('../../utils/clientFactory.cjs');
const { readOnlyEVMFromMirrorNode } = require('../../utils/solidityHelpers.cjs');

const contractName = 'UnifiedTokenSwap';

function showHelp() {
	console.log(`
Usage: node setupSwapConfig.cjs --contract <id> [action] [options]

Configure swap mappings and output tokens for UnifiedTokenSwap.

Required:
  --contract <id>         UnifiedTokenSwap contract ID

Actions (choose one):
  --add-token <id>        Associate an output token with the contract
                          Gas: ~1,400,000 (HTS association)
  --add-swap              Add a swap configuration (requires additional params)
                          Gas: ~400,000 (or ~1,500,000 if new input token)
  --remove-swap           Remove a swap configuration
  --batch-add <file>      Add swaps from JSON file
                          Gas: ~1,500,000+ for batches with new input tokens

Swap Configuration Parameters (for --add-swap):
  --input-token <id>      Input NFT token ID
  --input-serial <n>      Input NFT serial number
  --output-token <id>     Output NFT token ID
  --output-serial <n>     Output NFT serial number
  --treasury <id>         Treasury account (where input NFT goes)
  --use-graveyard         Use graveyard instead of treasury (flag)

Options:
  -h, --help              Show this help message
  --gas <amount>          Gas limit (auto-set per action if not specified)

Environment Variables:
  ACCOUNT_ID              Hedera operator account (must be admin)
  PRIVATE_KEY             Operator private key
  ENVIRONMENT             Network (TEST, MAIN, PREVIEW, LOCAL)

Examples:
  # Add output token
  node setupSwapConfig.cjs --contract 0.0.123456 --add-token 0.0.789012

  # Add single swap (treasury destination)
  node setupSwapConfig.cjs --contract 0.0.123456 --add-swap \\
    --input-token 0.0.111111 --input-serial 1 \\
    --output-token 0.0.222222 --output-serial 1 \\
    --treasury 0.0.333333

  # Add single swap (graveyard destination)
  node setupSwapConfig.cjs --contract 0.0.123456 --add-swap \\
    --input-token 0.0.111111 --input-serial 1 \\
    --output-token 0.0.222222 --output-serial 1 \\
    --use-graveyard

  # Batch add from JSON
  node setupSwapConfig.cjs --contract 0.0.123456 --batch-add swaps.json
`);
}

const main = async () => {
	if (getArgFlag('h') || getArgFlag('help')) {
		showHelp();
		process.exit(0);
	}

	const contractArg = getArg('contract');
	if (!contractArg) {
		console.error('ERROR: --contract is required');
		showHelp();
		process.exit(1);
	}

	const { client, operatorId, env } = initializeClient();
	const contractId = ContractId.fromString(contractArg);
	const userGas = Number(getArg('gas'));

	console.log(`\n-Using Contract: ${contractId}`);
	console.log(`-Using Operator: ${operatorId}`);

	// Load ABI
	const contractJson = JSON.parse(
		fs.readFileSync(
			`./artifacts/contracts/${contractName}.sol/${contractName}.json`,
		),
	);
	const iface = new ethers.Interface(contractJson.abi);

	// Pre-flight admin verification
	try {
		const operatorEvmAddress = operatorId.toSolidityAddress();
		const adminCheckData = iface.encodeFunctionData('isAdmin', [operatorEvmAddress]);
		const adminCheckResult = await readOnlyEVMFromMirrorNode(env, contractId, adminCheckData, operatorId, false);
		const isAdmin = iface.decodeFunctionResult('isAdmin', adminCheckResult)[0];
		if (!isAdmin) {
			console.error(`\nERROR: Operator ${operatorId} is not an admin of contract ${contractId}\n`);
			console.error(`Current admins can be checked with:`);
			console.error(`  node adminManagement.cjs --contract ${contractId} --info\n`);
			process.exit(1);
		}
	} catch (e) {
		console.warn(`\nWARNING: Could not verify admin status via mirror node: ${e.message || e}`);
		console.warn('Proceeding without pre-flight check...\n');
	}

	let functionName;
	let params;
	let description;

	let gasLimit;

	if (getArg('add-token')) {
		const tokenId = ContractId.fromString(getArg('add-token'));
		functionName = 'addOutputToken';
		params = iface.encodeFunctionData(functionName, [tokenId.toSolidityAddress()]);
		description = `Adding output token: ${tokenId}`;
		gasLimit = userGas || 1_400_000; // HTS association requires ~1.4M gas
	} else if (getArgFlag('add-swap')) {
		const inputTokenArg = getArg('input-token');
		const inputSerialArg = getArg('input-serial');
		const outputTokenArg = getArg('output-token');
		const outputSerialArg = getArg('output-serial');
		const treasuryArg = getArg('treasury');
		const useGraveyard = getArgFlag('use-graveyard');

		if (!inputTokenArg || !inputSerialArg || !outputTokenArg || !outputSerialArg) {
			console.error('ERROR: --add-swap requires --input-token, --input-serial, --output-token, --output-serial');
			process.exit(1);
		}

		if (!useGraveyard && !treasuryArg) {
			console.error('ERROR: Must specify either --treasury or --use-graveyard');
			process.exit(1);
		}

		const inputToken = ContractId.fromString(inputTokenArg);
		const inputSerial = Number(inputSerialArg);
		const outputToken = ContractId.fromString(outputTokenArg);
		const outputSerial = Number(outputSerialArg);
		const treasury = treasuryArg
			? AccountId.fromString(treasuryArg).toSolidityAddress()
			: '0x0000000000000000000000000000000000000000';

		const config = {
			outputToken: outputToken.toSolidityAddress(),
			treasury: treasury,
			useGraveyard: useGraveyard,
			outputSerial: outputSerial,
		};

		functionName = 'addSwapConfigs';
		params = iface.encodeFunctionData(functionName, [
			[inputToken.toSolidityAddress()],
			[inputSerial],
			[config],
		]);
		description = `Adding swap: ${inputToken}#${inputSerial} -> ${outputToken}#${outputSerial}`;
		gasLimit = userGas || 1_500_000; // May need HTS association for new input token
	} else if (getArgFlag('remove-swap')) {
		const inputTokenArg = getArg('input-token');
		const inputSerialArg = getArg('input-serial');

		if (!inputTokenArg || !inputSerialArg) {
			console.error('ERROR: --remove-swap requires --input-token and --input-serial');
			process.exit(1);
		}

		const inputToken = ContractId.fromString(inputTokenArg);
		const inputSerial = Number(inputSerialArg);

		functionName = 'removeSwapConfigs';
		params = iface.encodeFunctionData(functionName, [
			[inputToken.toSolidityAddress()],
			[inputSerial],
		]);
		description = `Removing swap: ${inputToken}#${inputSerial}`;
		gasLimit = userGas || 300_000;
	} else if (getArg('batch-add')) {
		const filename = getArg('batch-add');
		const swaps = JSON.parse(fs.readFileSync(filename, 'utf8'));

		const inputTokens = [];
		const inputSerials = [];
		const configs = [];

		for (const swap of swaps) {
			inputTokens.push(ContractId.fromString(swap.inputToken).toSolidityAddress());
			inputSerials.push(swap.inputSerial);
			configs.push({
				outputToken: ContractId.fromString(swap.outputToken).toSolidityAddress(),
				treasury: swap.treasury
					? AccountId.fromString(swap.treasury).toSolidityAddress()
					: '0x0000000000000000000000000000000000000000',
				useGraveyard: swap.useGraveyard || false,
				outputSerial: swap.outputSerial,
			});
		}

		functionName = 'addSwapConfigs';
		params = iface.encodeFunctionData(functionName, [inputTokens, inputSerials, configs]);
		description = `Batch adding ${swaps.length} swap configurations`;
		gasLimit = userGas || 1_500_000; // May need HTS association for new input tokens
	} else {
		console.error('ERROR: No action specified');
		showHelp();
		process.exit(1);
	}

	console.log(`\n${description}...`);

	const tx = new ContractExecuteTransaction()
		.setContractId(contractId)
		.setGas(gasLimit)
		.setFunctionParameters(Buffer.from(params.slice(2), 'hex'));

	const txResponse = await tx.execute(client);
	const receipt = await txResponse.getReceipt(client);

	console.log(`Status: ${receipt.status}`);
	console.log(`Transaction ID: ${txResponse.transactionId}`);

	client.close();
};

main()
	.then(() => process.exit(0))
	.catch((error) => {
		console.error('ERROR:', error.message || error);
		process.exit(1);
	});
