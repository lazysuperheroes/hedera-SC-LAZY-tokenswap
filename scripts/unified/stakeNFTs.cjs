const {
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
const { estimateGas } = require('../../utils/gasHelpers.cjs');

const contractName = 'UnifiedTokenSwap';

function showHelp() {
	console.log(`
Usage: node stakeNFTs.cjs --contract <id> --token <id> --serials <n,n,n> [options]

Stake (load) output NFTs into the UnifiedTokenSwap contract for distribution.
This is step 4 of deployment - loading the new NFTs the contract will give to swappers.

Required:
  --contract <id>         UnifiedTokenSwap contract ID
  --token <id>            NFT token ID to stake
  --serials <n,n,n>       Comma-separated list of serial numbers

Options:
  -h, --help              Show this help message
  --gas <amount>          Gas limit per batch (default: auto-estimate)
  --skip-allowance        Skip setting NFT allowances (if already set)
  --json                  Output result as JSON (for automation)

Environment Variables:
  ACCOUNT_ID              Hedera operator account
  PRIVATE_KEY             Operator private key
  ENVIRONMENT             Network (TEST, MAIN, PREVIEW, LOCAL)

Notes:
  The contract enforces MAX_NFTS_PER_TX = 8. If you provide more than 8
  serials, they will be automatically split into batches of 8.

  Before staking, the script sets NFT allowances so the contract can pull
  each NFT from your account. Use --skip-allowance if already set.

Examples:
  # Stake a few NFTs
  node stakeNFTs.cjs --contract 0.0.123456 --token 0.0.111111 --serials 1,2,3

  # Stake many NFTs (auto-batched into groups of 8)
  node stakeNFTs.cjs --contract 0.0.123456 --token 0.0.111111 --serials 1,2,3,4,5,6,7,8,9,10

  # Skip allowances if already set
  node stakeNFTs.cjs --contract 0.0.123456 --token 0.0.111111 --serials 1,2,3 --skip-allowance

  # JSON output for automation
  node stakeNFTs.cjs --contract 0.0.123456 --token 0.0.111111 --serials 1,2,3 --json
`);
}

const MAX_NFTS_PER_TX = 8;

const main = async () => {
	if (getArgFlag('h') || getArgFlag('help')) {
		showHelp();
		process.exit(0);
	}

	const contractArg = getArg('contract');
	const tokenArg = getArg('token');
	const serialsArg = getArg('serials');

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

	const jsonOutput = getArgFlag('json');
	const { client, operatorId, env } = initializeClient();
	const contractId = ContractId.fromString(contractArg);
	const tokenId = TokenId.fromString(tokenArg);

	// Parse serials
	const serials = serialsArg.split(',').map(s => Number(s.trim()));

	if (serials.length === 0 || serials.some(s => isNaN(s) || s <= 0)) {
		if (jsonOutput) {
			console.log(JSON.stringify({ success: false, error: 'Invalid serial numbers provided' }));
		} else {
			console.error('ERROR: Invalid serial numbers provided. Must be positive integers.');
		}
		process.exit(1);
	}

	if (!jsonOutput) {
		console.log(`\n-Using Contract: ${contractId}`);
		console.log(`-Using Operator: ${operatorId}`);
		console.log(`-Token: ${tokenId}`);
		console.log(`-Serials: ${serials.join(', ')}`);
		console.log(`-Total NFTs: ${serials.length}`);
	}

	// Load ABI
	const contractJson = JSON.parse(
		fs.readFileSync(
			`./artifacts/contracts/${contractName}.sol/${contractName}.json`,
		),
	);
	const iface = new ethers.Interface(contractJson.abi);

	// Set NFT allowances if not skipped
	if (!getArgFlag('skip-allowance')) {
		if (!jsonOutput) console.log('\nSetting NFT allowance for all serials...');

		// Use approveTokenNftAllowanceAllSerials to avoid Hedera's 100 allowance limit
		const allowanceTx = new AccountAllowanceApproveTransaction()
			.approveTokenNftAllowanceAllSerials(tokenId, operatorId, contractId);

		const allowanceResponse = await allowanceTx.execute(client);
		const allowanceReceipt = await allowanceResponse.getReceipt(client);
		if (!jsonOutput) console.log(`  Approved all serials: ${allowanceReceipt.status}`);
	}

	// Split serials into batches of MAX_NFTS_PER_TX
	const batches = [];
	for (let i = 0; i < serials.length; i += MAX_NFTS_PER_TX) {
		batches.push(serials.slice(i, i + MAX_NFTS_PER_TX));
	}

	if (!jsonOutput && batches.length > 1) {
		console.log(`\nSplitting ${serials.length} serials into ${batches.length} batches of up to ${MAX_NFTS_PER_TX}`);
	}

	// Execute staking batches
	const tokenAddress = tokenId.toSolidityAddress();
	const results = [];

	for (let b = 0; b < batches.length; b++) {
		const batch = batches[b];
		const batchLabel = batches.length > 1 ? ` [Batch ${b + 1}/${batches.length}]` : '';

		if (!jsonOutput) console.log(`\nStaking${batchLabel}: serials ${batch.join(', ')}...`);

		const stakeData = iface.encodeFunctionData('stakeNFTs', [tokenAddress, batch]);

		// Estimate gas or use provided
		let gasLimit = Number(getArg('gas'));
		if (!gasLimit) {
			const fallbackGas = 800_000;
			const gasResult = await estimateGas(
				env,
				contractId,
				iface,
				operatorId,
				'stakeNFTs',
				[tokenAddress, batch],
				fallbackGas,
			);
			gasLimit = gasResult.gasLimit;
		}

		const tx = new ContractExecuteTransaction()
			.setContractId(contractId)
			.setGas(gasLimit)
			.setFunctionParameters(Buffer.from(stakeData.slice(2), 'hex'));

		const txResponse = await tx.execute(client);
		const receipt = await txResponse.getReceipt(client);

		const success = receipt.status.toString() === 'SUCCESS';

		results.push({
			batch: b + 1,
			serials: batch,
			success,
			transactionId: txResponse.transactionId.toString(),
			status: receipt.status.toString(),
		});

		if (!jsonOutput) {
			console.log(`  Status: ${receipt.status}`);
			console.log(`  Transaction ID: ${txResponse.transactionId}`);
			if (success) {
				console.log(`  Staked ${batch.length} NFT(s)`);
			}
		}

		if (!success) {
			if (jsonOutput) {
				console.log(JSON.stringify({
					success: false,
					contract: contractId.toString(),
					token: tokenId.toString(),
					error: `Batch ${b + 1} failed with status: ${receipt.status}`,
					batches: results,
				}));
			} else {
				console.error(`\nERROR: Batch ${b + 1} failed. Stopping execution.`);
			}
			process.exit(1);
		}
	}

	// Summary
	const totalStaked = results.reduce((sum, r) => sum + r.serials.length, 0);

	if (jsonOutput) {
		console.log(JSON.stringify({
			success: true,
			contract: contractId.toString(),
			token: tokenId.toString(),
			totalStaked,
			batches: results,
		}));
	} else {
		console.log('\n=== Staking Complete ===');
		console.log(`Total NFTs staked: ${totalStaked}`);
		if (batches.length > 1) {
			console.log(`Batches completed: ${results.length}`);
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
