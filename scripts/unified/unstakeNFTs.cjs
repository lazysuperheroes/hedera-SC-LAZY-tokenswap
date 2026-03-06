const {
	ContractId,
	ContractExecuteTransaction,
	AccountId,
	TokenId,
} = require('@hashgraph/sdk');
const fs = require('fs');
const { ethers } = require('ethers');
const { getArgFlag, getArg } = require('../../utils/nodeHelpers.cjs');
const { initializeClient } = require('../../utils/clientFactory.cjs');
const { estimateGas } = require('../../utils/gasHelpers.cjs');

const contractName = 'UnifiedTokenSwap';
const MAX_NFTS_PER_TX = 8;

function showHelp() {
	console.log(`
Usage: node unstakeNFTs.cjs --contract <id> --token <id> --serials <n,n,n> --receiver <id> [options]

Unstake (recover) NFTs from the UnifiedTokenSwap contract. Admin only.
The receiver must have HBAR allowance to the contract (1 tinybar per batch).

Required:
  --contract <id>         UnifiedTokenSwap contract ID
  --token <id>            NFT token ID to unstake
  --serials <n,n,n>       Comma-separated list of serial numbers
  --receiver <id>         Account to receive the NFTs

Options:
  -h, --help              Show this help message
  --gas <amount>          Gas limit per batch (default: auto-estimate)
  --json                  Output result as JSON (for automation)

Environment Variables:
  ACCOUNT_ID              Hedera operator account (must be admin)
  PRIVATE_KEY             Operator private key
  ENVIRONMENT             Network (TEST, MAIN, PREVIEW, LOCAL)

Examples:
  # Unstake a few NFTs
  node unstakeNFTs.cjs --contract 0.0.123456 --token 0.0.111111 --serials 1,2,3 --receiver 0.0.789012

  # Unstake more than 8 (auto-batched)
  node unstakeNFTs.cjs --contract 0.0.123456 --token 0.0.111111 --serials 1,2,3,4,5,6,7,8,9,10 --receiver 0.0.789012

  # With explicit gas limit per batch
  node unstakeNFTs.cjs --contract 0.0.123456 --token 0.0.111111 --serials 1,2 --receiver 0.0.789012 --gas 900000

  # JSON output for automation
  node unstakeNFTs.cjs --contract 0.0.123456 --token 0.0.111111 --serials 1,2,3 --receiver 0.0.789012 --json
`);
}

const main = async () => {
	if (getArgFlag('h') || getArgFlag('help')) {
		showHelp();
		process.exit(0);
	}

	const contractArg = getArg('contract');
	const tokenArg = getArg('token');
	const serialsArg = getArg('serials');
	const receiverArg = getArg('receiver');

	if (!contractArg) {
		console.error('ERROR: --contract is required');
		showHelp();
		process.exit(1);
	}

	if (!tokenArg) {
		console.error('ERROR: --token is required');
		showHelp();
		process.exit(1);
	}

	if (!serialsArg) {
		console.error('ERROR: --serials is required');
		showHelp();
		process.exit(1);
	}

	if (!receiverArg) {
		console.error('ERROR: --receiver is required');
		showHelp();
		process.exit(1);
	}

	const jsonOutput = getArgFlag('json');
	const { client, operatorId, env } = initializeClient();
	const contractId = ContractId.fromString(contractArg);
	const tokenId = TokenId.fromString(tokenArg);
	const receiverId = AccountId.fromString(receiverArg);

	// Parse serials
	const serials = serialsArg.split(',').map(s => Number(s.trim()));

	if (serials.length === 0 || serials.some(s => isNaN(s) || s <= 0)) {
		console.error('ERROR: --serials must be a comma-separated list of positive integers');
		process.exit(1);
	}

	if (!jsonOutput) {
		console.log(`\n-Using Contract: ${contractId}`);
		console.log(`-Using Operator: ${operatorId}`);
		console.log(`-Token: ${tokenId}`);
		console.log(`-Receiver: ${receiverId}`);
		console.log(`-Serials: ${serials.join(', ')} (${serials.length} total)`);
	}

	// Warning about HBAR allowance
	const totalBatches = Math.ceil(serials.length / MAX_NFTS_PER_TX);

	if (!jsonOutput) {
		console.log('\n========================================');
		console.log('  WARNING: The receiver account must have');
		console.log('  HBAR allowance to the contract');
		console.log(`  (1 tinybar per batch, ${totalBatches} batch(es) needed).`);
		console.log('  The transaction will fail if the');
		console.log('  allowance is not set.');
		console.log('========================================');
	}

	// Load ABI
	const contractJson = JSON.parse(
		fs.readFileSync(
			`./artifacts/contracts/${contractName}.sol/${contractName}.json`,
		),
	);
	const iface = new ethers.Interface(contractJson.abi);

	// Split serials into batches of MAX_NFTS_PER_TX
	const batches = [];
	for (let i = 0; i < serials.length; i += MAX_NFTS_PER_TX) {
		batches.push(serials.slice(i, i + MAX_NFTS_PER_TX));
	}

	if (!jsonOutput && batches.length > 1) {
		console.log(`\nSplitting ${serials.length} serials into ${batches.length} batch(es) of up to ${MAX_NFTS_PER_TX}`);
	}

	const results = [];

	for (let b = 0; b < batches.length; b++) {
		const batch = batches[b];
		const batchLabel = batches.length > 1 ? ` [Batch ${b + 1}/${batches.length}]` : '';

		if (!jsonOutput) {
			console.log(`\n--- Unstaking${batchLabel}: serials ${batch.join(', ')} ---`);
		}

		const tokenSolidityAddr = tokenId.toSolidityAddress();
		const receiverSolidityAddr = receiverId.toSolidityAddress();

		// Estimate gas or use provided
		let gasLimit = Number(getArg('gas'));
		if (!gasLimit) {
			const fallbackGas = 800_000;
			const gasResult = await estimateGas(
				env,
				contractId,
				iface,
				operatorId,
				'unstakeNFTs',
				[tokenSolidityAddr, batch, receiverSolidityAddr],
				fallbackGas,
			);
			gasLimit = gasResult.gasLimit;
		}

		const unstakeData = iface.encodeFunctionData('unstakeNFTs', [
			tokenSolidityAddr,
			batch,
			receiverSolidityAddr,
		]);

		const tx = new ContractExecuteTransaction()
			.setContractId(contractId)
			.setGas(gasLimit)
			.setFunctionParameters(Buffer.from(unstakeData.slice(2), 'hex'));

		const txResponse = await tx.execute(client);
		const receipt = await txResponse.getReceipt(client);

		const success = receipt.status.toString() === 'SUCCESS';

		const batchResult = {
			batch: b + 1,
			serials: batch,
			success,
			transactionId: txResponse.transactionId.toString(),
			status: receipt.status.toString(),
		};

		results.push(batchResult);

		if (!jsonOutput) {
			console.log(`Status: ${receipt.status}`);
			console.log(`Transaction ID: ${txResponse.transactionId}`);

			if (success) {
				console.log(`Unstaked ${batch.length} NFT(s) successfully`);
			} else {
				console.error(`Batch ${b + 1} failed!`);
			}
		}

		// Stop processing if a batch fails
		if (!success) {
			if (!jsonOutput) {
				console.error('\nStopping: batch failed. Remaining serials not processed.');
			}
			break;
		}
	}

	const allSuccess = results.every(r => r.success);
	const totalUnstaked = results.filter(r => r.success).reduce((sum, r) => sum + r.serials.length, 0);

	if (jsonOutput) {
		console.log(JSON.stringify({
			success: allSuccess,
			contract: contractId.toString(),
			token: tokenId.toString(),
			receiver: receiverId.toString(),
			totalSerials: serials.length,
			totalUnstaked,
			totalBatches: batches.length,
			batchesCompleted: results.length,
			batches: results,
		}));
	} else {
		console.log('\n=== Summary ===');
		console.log(`Total unstaked: ${totalUnstaked}/${serials.length} NFT(s)`);
		console.log(`Batches completed: ${results.length}/${batches.length}`);
		if (allSuccess) {
			console.log('All batches completed successfully!');
		} else {
			console.log('Some batches failed. Check output above for details.');
		}
	}

	client.close();

	if (!allSuccess) {
		process.exit(1);
	}
};

main()
	.then(() => process.exit(0))
	.catch((error) => {
		console.error('ERROR:', error.message || error);
		process.exit(1);
	});
