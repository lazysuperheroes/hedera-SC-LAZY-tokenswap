const {
	AccountId,
	ContractId,
	ContractExecuteTransaction,
	AccountAllowanceApproveTransaction,
	NftId,
	TokenId,
} = require('@hashgraph/sdk');
const fs = require('fs');
const { ethers } = require('ethers');
const { getArgFlag, getArg } = require('../../utils/nodeHelpers.cjs');
const { initializeClient } = require('../../utils/clientFactory.cjs');
const { readOnlyEVMFromMirrorNode } = require('../../utils/solidityHelpers.cjs');
const { estimateGas } = require('../../utils/gasHelpers.cjs');

const contractName = 'UnifiedTokenSwap';

function showHelp() {
	console.log(`
Usage: node unifiedSwap.js --contract <id> [options]

Perform NFT swaps using UnifiedTokenSwap contract.

Required:
  --contract <id>         UnifiedTokenSwap contract ID

Swap Options:
  --token <id>            Input NFT token ID
  --serial <n>            Input NFT serial number (can specify multiple)
  --serials <n,n,n>       Comma-separated list of serials (same token)

Query Options:
  --check                 Check swap configuration before executing
  --query                 Only query, don't execute swap

Options:
  -h, --help              Show this help message
  --gas <amount>          Gas limit (default: auto-estimate)
  --skip-allowance        Skip setting NFT allowance (if already set)
  --json                  Output result as JSON (for automation)

Environment Variables:
  ACCOUNT_ID              Hedera operator account
  PRIVATE_KEY             Operator private key
  ENVIRONMENT             Network (TEST, MAIN, PREVIEW, LOCAL)

Examples:
  # Query swap configuration
  node unifiedSwap.js --contract 0.0.123456 --token 0.0.111111 --serial 1 --query

  # Execute single swap
  node unifiedSwap.js --contract 0.0.123456 --token 0.0.111111 --serial 1

  # Execute multiple swaps (same token)
  node unifiedSwap.js --contract 0.0.123456 --token 0.0.111111 --serials 1,2,3

  # Check and execute
  node unifiedSwap.js --contract 0.0.123456 --token 0.0.111111 --serial 1 --check
`);
}

const main = async () => {
	if (getArgFlag('h') || getArgFlag('help')) {
		showHelp();
		process.exit(0);
	}

	const contractArg = getArg('contract');
	const tokenArg = getArg('token');
	const serialArg = getArg('serial');
	const serialsArg = getArg('serials');

	if (!contractArg) {
		console.error('ERROR: --contract is required');
		showHelp();
		process.exit(1);
	}

	if (!tokenArg || (!serialArg && !serialsArg)) {
		console.error('ERROR: --token and (--serial or --serials) are required');
		showHelp();
		process.exit(1);
	}

	const jsonOutput = getArgFlag('json');
	const { client, operatorId, env } = initializeClient();
	const contractId = ContractId.fromString(contractArg);
	const tokenId = TokenId.fromString(tokenArg);

	// Parse serials
	let serials = [];
	if (serialsArg) {
		serials = serialsArg.split(',').map(s => Number(s.trim()));
	} else {
		serials = [Number(serialArg)];
	}

	if (!jsonOutput) {
		console.log(`\n-Using Contract: ${contractId}`);
		console.log(`-Using Operator: ${operatorId}`);
		console.log(`-Input Token: ${tokenId}`);
		console.log(`-Serials: ${serials.join(', ')}`);
	}

	// Load ABI
	const contractJson = JSON.parse(
		fs.readFileSync(
			`./artifacts/contracts/${contractName}.sol/${contractName}.json`,
		),
	);
	const iface = new ethers.Interface(contractJson.abi);

	// Query swap configurations
	const inputTokens = serials.map(() => tokenId.toSolidityAddress());
	const inputSerials = serials;

	const encodedQuery = iface.encodeFunctionData('getSwapConfigs', [inputTokens, inputSerials]);
	const result = await readOnlyEVMFromMirrorNode(env, contractId, encodedQuery, operatorId, false);
	const configs = iface.decodeFunctionResult('getSwapConfigs', result)[0];

	// Build configuration data for output
	const configData = [];
	let hasInvalidConfig = false;
	for (let i = 0; i < serials.length; i++) {
		const config = configs[i];
		const isValid = config.outputToken !== '0x0000000000000000000000000000000000000000';

		if (isValid) {
			const outputTokenId = AccountId.fromEvmAddress(0, 0, config.outputToken);
			const treasuryId = config.useGraveyard ? null : AccountId.fromEvmAddress(0, 0, config.treasury);
			configData.push({
				serial: serials[i],
				configured: true,
				outputToken: outputTokenId.toString(),
				outputSerial: Number(config.outputSerial),
				destination: config.useGraveyard ? 'graveyard' : 'treasury',
				treasury: treasuryId ? treasuryId.toString() : null,
			});
		} else {
			configData.push({ serial: serials[i], configured: false });
			hasInvalidConfig = true;
		}
	}

	if (!jsonOutput) {
		console.log('\n=== Swap Configurations ===\n');
		for (const cfg of configData) {
			console.log(`Serial #${cfg.serial}:`);
			if (cfg.configured) {
				console.log(`  Output: ${cfg.outputToken}#${cfg.outputSerial}`);
				console.log(`  Destination: ${cfg.destination === 'graveyard' ? 'Graveyard' : 'Treasury'}`);
				if (cfg.treasury) {
					console.log(`  Treasury: ${cfg.treasury}`);
				}
			} else {
				console.log('  [NOT CONFIGURED]');
			}
		}
	}

	if (getArgFlag('query')) {
		if (jsonOutput) {
			console.log(JSON.stringify({
				mode: 'query',
				contract: contractId.toString(),
				token: tokenId.toString(),
				configurations: configData,
			}));
		}
		client.close();
		return;
	}

	if (hasInvalidConfig) {
		if (jsonOutput) {
			console.log(JSON.stringify({ success: false, error: 'One or more serials have no swap configuration' }));
		} else {
			console.error('\nERROR: One or more serials have no swap configuration');
		}
		process.exit(1);
	}

	// Check pause status
	const pausedQuery = iface.encodeFunctionData('paused', []);
	const pausedResult = await readOnlyEVMFromMirrorNode(env, contractId, pausedQuery, operatorId, false);
	const isPaused = iface.decodeFunctionResult('paused', pausedResult)[0];

	if (isPaused) {
		if (jsonOutput) {
			console.log(JSON.stringify({ success: false, error: 'Contract is paused' }));
		} else {
			console.error('\nERROR: Contract is paused');
		}
		process.exit(1);
	}

	if (getArgFlag('check')) {
		if (jsonOutput) {
			console.log(JSON.stringify({
				mode: 'check',
				contract: contractId.toString(),
				token: tokenId.toString(),
				valid: true,
				configurations: configData,
			}));
		} else {
			console.log('\n[Check mode] Configuration valid. Use without --check to execute.');
		}
		client.close();
		return;
	}

	// Set NFT allowances if not skipped
	if (!getArgFlag('skip-allowance')) {
		if (!jsonOutput) console.log('\nSetting NFT allowances...');

		for (const serial of serials) {
			const nftId = new NftId(tokenId, serial);
			const allowanceTx = new AccountAllowanceApproveTransaction()
				.approveTokenNftAllowance(nftId, operatorId, contractId);

			const allowanceResponse = await allowanceTx.execute(client);
			const allowanceReceipt = await allowanceResponse.getReceipt(client);
			if (!jsonOutput) console.log(`  Serial #${serial}: ${allowanceReceipt.status}`);
		}
	}

	// Execute swap
	if (!jsonOutput) console.log('\nExecuting swap...');

	const swapData = iface.encodeFunctionData('swapNFTs', [inputTokens, inputSerials]);

	// Estimate gas or use provided
	let gasLimit = Number(getArg('gas'));
	if (!gasLimit) {
		try {
			const estimated = await estimateGas(
				env,
				contractId,
				swapData,
				operatorId,
			);
			gasLimit = Math.ceil(estimated * 1.2); // 20% buffer
			if (!jsonOutput) console.log(`Estimated gas: ${estimated}, using: ${gasLimit}`);
		} catch {
			gasLimit = 400_000 * serials.length;
			if (!jsonOutput) console.log(`Gas estimation failed, using default: ${gasLimit}`);
		}
	}

	const tx = new ContractExecuteTransaction()
		.setContractId(contractId)
		.setGas(gasLimit)
		.setFunctionParameters(Buffer.from(swapData.slice(2), 'hex'));

	const txResponse = await tx.execute(client);
	const receipt = await txResponse.getReceipt(client);

	const success = receipt.status.toString() === 'SUCCESS';

	if (jsonOutput) {
		console.log(JSON.stringify({
			success,
			mode: 'swap',
			contract: contractId.toString(),
			token: tokenId.toString(),
			serials,
			transactionId: txResponse.transactionId.toString(),
			status: receipt.status.toString(),
			swappedCount: success ? serials.length : 0,
		}));
	} else {
		console.log(`\nStatus: ${receipt.status}`);
		console.log(`Transaction ID: ${txResponse.transactionId}`);

		if (success) {
			console.log('\nSwap completed successfully!');
			console.log(`Swapped ${serials.length} NFT(s)`);
		}
	}

	client.close();
};

main()
	.then(() => process.exit(0))
	.catch((error) => {
		console.error('ERROR:', error.message || error);
		process.exit(1);
	});
