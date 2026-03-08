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
const { estimateGas } = require('../../utils/gasHelpers.cjs');
const { getTokenDetails } = require('../../utils/hederaMirrorHelpers.cjs');

const contractName = 'UnifiedTokenSwap';

function showHelp() {
	console.log(`
Usage: node setupSwapConfig.cjs --contract <id> [action] [options]

Configure swap mappings and output tokens for UnifiedTokenSwap.

Required:
  --contract <id>         UnifiedTokenSwap contract ID

Actions (choose one):
  --add-token <id>        Associate an output token with the contract
  --add-swap              Add a swap configuration (requires additional params)
  --remove-swap           Remove a swap configuration
  --batch-add <file>      Add swaps from JSON file (auto-batches in groups of 30)
  --query-all <file>      Query configs from a swaps JSON file (read-only)
  --query                 Discover and display all active swap configs (read-only)

Gas is estimated automatically via mirror node for each operation.

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

	// Check graveyard approval count for graveyard-mode warnings
	async function checkGraveyardCapacity() {
		try {
			const countData = iface.encodeFunctionData('getGraveyardApprovalCount', []);
			const countResult = await readOnlyEVMFromMirrorNode(env, contractId, countData, operatorId, false);
			const count = Number(iface.decodeFunctionResult('getGraveyardApprovalCount', countResult)[0]);
			if (count >= 90) {
				console.warn(`\nWARNING: Graveyard has ${count}/~100 token approvals used.`);
				console.warn('Hedera limits accounts to ~100 allowance slots.');
				console.warn('New graveyard-mode input tokens may fail if the limit is reached.\n');
			} else {
				console.log(`\nGraveyard approval slots used: ${count}/~100`);
			}
		} catch {
			// Older contract or mirror node issue - skip silently
		}
	}

	let functionName;
	let params;
	let description;

	let gasLimit;

	if (getArg('add-token')) {
		const tokenId = ContractId.fromString(getArg('add-token'));
		functionName = 'addOutputToken';
		const fnParams = [tokenId.toSolidityAddress()];
		params = iface.encodeFunctionData(functionName, fnParams);
		description = `Adding output token: ${tokenId}`;
		const gasResult = await estimateGas(env, contractId, iface, operatorId, functionName, fnParams, 1_400_000);
		gasLimit = userGas || gasResult.gasLimit;
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
		const fnParams = [
			[inputToken.toSolidityAddress()],
			[inputSerial],
			[config],
		];
		params = iface.encodeFunctionData(functionName, fnParams);
		description = `Adding swap: ${inputToken}#${inputSerial} -> ${outputToken}#${outputSerial}`;
		const gasResult = await estimateGas(env, contractId, iface, operatorId, functionName, fnParams, 1_500_000);
		gasLimit = userGas || gasResult.gasLimit;

		if (useGraveyard) {
			await checkGraveyardCapacity();
		}
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
		const fnParams = [
			[inputToken.toSolidityAddress()],
			[inputSerial],
		];
		params = iface.encodeFunctionData(functionName, fnParams);
		description = `Removing swap: ${inputToken}#${inputSerial}`;
		const gasResult = await estimateGas(env, contractId, iface, operatorId, functionName, fnParams, 300_000);
		gasLimit = userGas || gasResult.gasLimit;
	} else if (getArg('batch-add')) {
		const MAX_PER_BATCH = 30;
		// Gas: ~100K per config + ~950K per new token association
		const FALLBACK_GAS_PER_CONFIG = 100_000;
		const FALLBACK_GAS_ASSOCIATION = 950_000;

		const filename = getArg('batch-add');
		const swaps = JSON.parse(fs.readFileSync(filename, 'utf8'));

		const hasGraveyard = swaps.some(s => s.useGraveyard);
		if (hasGraveyard) {
			await checkGraveyardCapacity();
		}

		// Filter out already-completed entries (resumability)
		const pendingIndices = [];
		for (let i = 0; i < swaps.length; i++) {
			if (!swaps[i].completed) {
				pendingIndices.push(i);
			}
		}

		if (pendingIndices.length === 0) {
			console.log('\nAll swap configurations already completed. Nothing to do.');
			client.close();
			return;
		}

		if (pendingIndices.length < swaps.length) {
			console.log(`\nResuming: ${swaps.length - pendingIndices.length} already completed, ${pendingIndices.length} remaining.`);
		}

		// Build batches from pending entries
		const totalBatches = Math.ceil(pendingIndices.length / MAX_PER_BATCH);
		console.log(`\nBatch adding ${pendingIndices.length} swap configurations in ${totalBatches} batch(es) of up to ${MAX_PER_BATCH}...`);

		for (let b = 0; b < totalBatches; b++) {
			const batchStart = b * MAX_PER_BATCH;
			const batchEnd = Math.min(batchStart + MAX_PER_BATCH, pendingIndices.length);
			const batchIndices = pendingIndices.slice(batchStart, batchEnd);

			const batchTokens = [];
			const batchSerials = [];
			const batchConfigs = [];
			const seenTokens = new Set();

			for (const idx of batchIndices) {
				const swap = swaps[idx];
				const tokenAddr = ContractId.fromString(swap.inputToken).toSolidityAddress();
				batchTokens.push(tokenAddr);
				batchSerials.push(swap.inputSerial);
				batchConfigs.push({
					outputToken: ContractId.fromString(swap.outputToken).toSolidityAddress(),
					treasury: swap.treasury
						? AccountId.fromString(swap.treasury).toSolidityAddress()
						: '0x0000000000000000000000000000000000000000',
					useGraveyard: swap.useGraveyard || false,
					outputSerial: swap.outputSerial,
				});
				seenTokens.add(tokenAddr);
			}

			const batchFnParams = [batchTokens, batchSerials, batchConfigs];
			const batchParams = iface.encodeFunctionData('addSwapConfigs', batchFnParams);

			// Calculate fallback: per-config gas + association gas for unique tokens in batch
			const fallbackGas = (batchIndices.length * FALLBACK_GAS_PER_CONFIG)
				+ (seenTokens.size * FALLBACK_GAS_ASSOCIATION);

			console.log(`\n  Batch ${b + 1}/${totalBatches} (${batchIndices.length} configs, ${seenTokens.size} unique token(s))...`);

			const gasResult = await estimateGas(env, contractId, iface, operatorId, 'addSwapConfigs', batchFnParams, fallbackGas);
			const batchGas = userGas || gasResult.gasLimit;

			const batchTx = new ContractExecuteTransaction()
				.setContractId(contractId)
				.setGas(batchGas)
				.setFunctionParameters(Buffer.from(batchParams.slice(2), 'hex'));

			const batchResponse = await batchTx.execute(client);
			const batchReceipt = await batchResponse.getReceipt(client);

			console.log(`  Status: ${batchReceipt.status}`);
			console.log(`  Transaction ID: ${batchResponse.transactionId}`);

			if (batchReceipt.status.toString() !== 'SUCCESS') {
				// Save progress before exiting
				fs.writeFileSync(filename, JSON.stringify(swaps, null, 2));
				console.error(`\nERROR: Batch ${b + 1} failed. Progress saved to ${filename}.`);
				console.error(`  Re-run the same command to resume from where it left off.`);
				process.exit(1);
			}

			// Mark completed entries and save progress
			for (const idx of batchIndices) {
				swaps[idx].completed = true;
			}
			fs.writeFileSync(filename, JSON.stringify(swaps, null, 2));
		}

		console.log(`\nAll ${pendingIndices.length} swap configurations added successfully.`);
		client.close();
		return;
	} else if (getArg('query-all')) {
		const filename = getArg('query-all');
		const swaps = JSON.parse(fs.readFileSync(filename, 'utf8'));

		console.log(`\nQuerying ${swaps.length} swap configurations from ${filename}...`);

		// Query in batches of 30 via mirror node (read-only, no gas cost)
		const QUERY_BATCH = 30;
		let configured = 0;
		let consumed = 0;

		for (let b = 0; b < swaps.length; b += QUERY_BATCH) {
			const batch = swaps.slice(b, Math.min(b + QUERY_BATCH, swaps.length));
			const tokens = batch.map(s => ContractId.fromString(s.inputToken).toSolidityAddress());
			const serials = batch.map(s => s.inputSerial);

			const encodedCall = iface.encodeFunctionData('getSwapConfigs', [tokens, serials]);
			const result = await readOnlyEVMFromMirrorNode(env, contractId, encodedCall, operatorId, false);
			const configs = iface.decodeFunctionResult('getSwapConfigs', result)[0];

			for (let i = 0; i < batch.length; i++) {
				const swap = batch[i];
				const config = configs[i];
				const isConfigured = config.outputToken !== '0x0000000000000000000000000000000000000000';

				if (isConfigured) {
					configured++;
					const outputTokenId = AccountId.fromEvmAddress(0, 0, config.outputToken).toString();
					console.log(`  [ACTIVE] ${swap.inputToken}#${swap.inputSerial} -> ${outputTokenId}#${Number(config.outputSerial)} ${config.useGraveyard ? '(graveyard)' : '(treasury)'}`);
				} else {
					consumed++;
					console.log(`  [EMPTY]  ${swap.inputToken}#${swap.inputSerial} -> (no config / already swapped)`);
				}
			}
		}

		console.log(`\nSummary: ${configured} active, ${consumed} empty/consumed, ${swaps.length} total`);
		client.close();
		return;
	} else if (getArgFlag('query')) {
		// Discover all active configs by querying input tokens + mirror node serial ranges
		console.log('\nDiscovering swap configurations...');

		// Step 1: Get input tokens from contract
		const inputTokensData = iface.encodeFunctionData('getInputTokens', []);
		const inputTokensResult = await readOnlyEVMFromMirrorNode(env, contractId, inputTokensData, operatorId, false);
		const inputTokenAddrs = iface.decodeFunctionResult('getInputTokens', inputTokensResult)[0];

		if (inputTokenAddrs.length === 0) {
			console.log('\nNo input tokens configured.');
			client.close();
			return;
		}

		const inputTokenIds = inputTokenAddrs.map(addr => AccountId.fromEvmAddress(0, 0, addr).toString());
		console.log(`\nInput tokens: ${inputTokenIds.join(', ')}`);

		let totalConfigured = 0;
		let totalChecked = 0;
		const QUERY_BATCH = 30;

		for (let t = 0; t < inputTokenAddrs.length; t++) {
			const tokenAddr = inputTokenAddrs[t];
			const tokenId = inputTokenIds[t];

			// Step 2: Get total supply from mirror node to know serial range
			const tokenDetails = await getTokenDetails(env, tokenId);
			if (!tokenDetails) {
				console.log(`\n  ${tokenId}: Could not query token details, skipping.`);
				continue;
			}

			const totalSupply = Number(tokenDetails.total_supply);
			console.log(`\n  ${tokenId} (${tokenDetails.name || tokenDetails.symbol}) - ${totalSupply} serials`);

			// Step 3: Query serials 1..totalSupply in batches
			let tokenConfigured = 0;
			for (let s = 1; s <= totalSupply; s += QUERY_BATCH) {
				const batchEnd = Math.min(s + QUERY_BATCH - 1, totalSupply);
				const batchSize = batchEnd - s + 1;

				const tokens = new Array(batchSize).fill(tokenAddr);
				const serials = [];
				for (let i = s; i <= batchEnd; i++) serials.push(i);

				const encodedCall = iface.encodeFunctionData('getSwapConfigs', [tokens, serials]);
				const result = await readOnlyEVMFromMirrorNode(env, contractId, encodedCall, operatorId, false);
				const configs = iface.decodeFunctionResult('getSwapConfigs', result)[0];

				for (let i = 0; i < batchSize; i++) {
					const config = configs[i];
					const isConfigured = config.outputToken !== '0x0000000000000000000000000000000000000000';
					totalChecked++;

					if (isConfigured) {
						tokenConfigured++;
						totalConfigured++;
						const outputTokenId = AccountId.fromEvmAddress(0, 0, config.outputToken).toString();
						console.log(`    [ACTIVE] #${serials[i]} -> ${outputTokenId}#${Number(config.outputSerial)} ${config.useGraveyard ? '(graveyard)' : '(treasury)'}`);
					}
				}
			}

			if (tokenConfigured === 0) {
				console.log('    (no active configs)');
			}
		}

		console.log(`\nSummary: ${totalConfigured} active configs found across ${totalChecked} serials checked`);
		client.close();
		return;
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
