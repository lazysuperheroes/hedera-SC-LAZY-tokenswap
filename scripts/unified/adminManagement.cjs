const {
	AccountId,
	ContractId,
	ContractExecuteTransaction,
	Hbar,
	TransferTransaction,
} = require('@hashgraph/sdk');
const fs = require('fs');
const { ethers } = require('ethers');
const { getArgFlag, getArg } = require('../../utils/nodeHelpers.cjs');
const { initializeClient } = require('../../utils/clientFactory.cjs');
const { readOnlyEVMFromMirrorNode } = require('../../utils/solidityHelpers.cjs');
const { checkMirrorHbarBalance } = require('../../utils/hederaMirrorHelpers.cjs');
const { estimateGas } = require('../../utils/gasHelpers.cjs');

const contractName = 'UnifiedTokenSwap';

function showHelp() {
	console.log(`
Usage: node adminManagement.cjs --contract <id> [action] [options]

Manage admins and settings for a UnifiedTokenSwap contract.

Required:
  --contract <id>         UnifiedTokenSwap contract ID (e.g., 0.0.123456)

Actions (choose one):
  --add-admin <id>        Add an admin account
  --remove-admin <id>     Remove an admin account (cannot remove last admin)
  --set-graveyard <id>    Set the Token Graveyard contract
  --pause                 Pause the contract
  --unpause               Unpause the contract
  --info                  Display current contract configuration
  --fund-hbar <amount>    Send HBAR to contract (in whole HBAR, e.g., 5)

Options:
  -h, --help              Show this help message
  --gas <amount>          Gas limit override (auto-estimated if not specified)
  --json                  Output result as JSON (for automation, works with --info)

Environment Variables:
  ACCOUNT_ID              Hedera operator account (must be admin)
  PRIVATE_KEY             Operator private key
  ENVIRONMENT             Network (TEST, MAIN, PREVIEW, LOCAL)

Examples:
  node adminManagement.cjs --contract 0.0.123456 --info
  node adminManagement.cjs --contract 0.0.123456 --add-admin 0.0.789012
  node adminManagement.cjs --contract 0.0.123456 --unpause
  node adminManagement.cjs --contract 0.0.123456 --set-graveyard 0.0.456789
  node adminManagement.cjs --contract 0.0.123456 --fund-hbar 5
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

	const jsonOutput = getArgFlag('json');
	const { client, operatorId, env } = initializeClient();
	const contractId = ContractId.fromString(contractArg);
	const userGas = Number(getArg('gas'));

	if (!jsonOutput) {
		console.log(`\n-Using Contract: ${contractId}`);
		console.log(`-Using Operator: ${operatorId}`);
		console.log(`-Environment: ${env}`);
	}

	// Load ABI
	const contractJson = JSON.parse(
		fs.readFileSync(
			`./artifacts/contracts/${contractName}.sol/${contractName}.json`,
		),
	);
	const iface = new ethers.Interface(contractJson.abi);

	// Pre-flight admin verification (skip for read-only --info and --fund-hbar)
	if (!getArgFlag('info') && !getArg('fund-hbar')) {
		try {
			const operatorEvmAddress = operatorId.toSolidityAddress();
			const adminCheckData = iface.encodeFunctionData('isAdmin', [operatorEvmAddress]);
			const adminCheckResult = await readOnlyEVMFromMirrorNode(env, contractId, adminCheckData, operatorId, false);
			const isAdmin = iface.decodeFunctionResult('isAdmin', adminCheckResult)[0];
			if (!isAdmin) {
				console.error(`\nERROR: Operator ${operatorId} is not an admin of contract ${contractId}\n`);
				console.error('Current admins can be checked with:');
				console.error(`  node adminManagement.cjs --contract ${contractId} --info\n`);
				process.exit(1);
			}
		} catch (e) {
			console.warn(`\nWARNING: Could not verify admin status via mirror node: ${e.message || e}`);
			console.warn('Proceeding without pre-flight check...\n');
		}
	}

	// Handle --info
	if (getArgFlag('info')) {
		await showContractInfo(env, contractId, operatorId, iface, jsonOutput);
		client.close();
		return;
	}

	// Handle actions
	let functionName;
	let fnParams;
	let params;
	let description;

	if (getArg('add-admin')) {
		const adminId = AccountId.fromString(getArg('add-admin'));
		functionName = 'addAdmin';
		fnParams = [adminId.toSolidityAddress()];
		params = iface.encodeFunctionData(functionName, fnParams);
		description = `Adding admin: ${adminId}`;
	} else if (getArg('remove-admin')) {
		const adminId = AccountId.fromString(getArg('remove-admin'));
		functionName = 'removeAdmin';
		fnParams = [adminId.toSolidityAddress()];
		params = iface.encodeFunctionData(functionName, fnParams);
		description = `Removing admin: ${adminId}`;
	} else if (getArg('set-graveyard')) {
		const graveyardId = ContractId.fromString(getArg('set-graveyard'));
		functionName = 'updateGraveyard';
		fnParams = [graveyardId.toSolidityAddress()];
		params = iface.encodeFunctionData(functionName, fnParams);
		description = `Setting graveyard: ${graveyardId}`;
	} else if (getArgFlag('pause')) {
		functionName = 'updatePauseStatus';
		fnParams = [true];
		params = iface.encodeFunctionData(functionName, fnParams);
		description = 'Pausing contract';
	} else if (getArgFlag('unpause')) {
		functionName = 'updatePauseStatus';
		fnParams = [false];
		params = iface.encodeFunctionData(functionName, fnParams);
		description = 'Unpausing contract';
	} else if (getArg('fund-hbar')) {
		const hbarAmount = Number(getArg('fund-hbar'));
		if (!hbarAmount || hbarAmount <= 0) {
			console.error('ERROR: --fund-hbar requires a positive number (in whole HBAR)');
			process.exit(1);
		}

		console.log(`\nSending ${hbarAmount} HBAR to contract ${contractId}...`);

		try {
			const transferTx = new TransferTransaction()
				.addHbarTransfer(operatorId.toString(), Hbar.from(-hbarAmount))
				.addHbarTransfer(contractId.toString(), Hbar.from(hbarAmount));

			const txResponse = await transferTx.execute(client);
			const receipt = await txResponse.getReceipt(client);

			if (jsonOutput) {
				console.log(JSON.stringify({
					success: receipt.status.toString() === 'SUCCESS',
					action: 'fund-hbar',
					contract: contractId.toString(),
					amount: hbarAmount,
					status: receipt.status.toString(),
				}));
			} else {
				console.log(`Status: ${receipt.status}`);
				console.log(`Transaction ID: ${txResponse.transactionId}`);
			}
		} catch (error) {
			console.error('\nERROR during HBAR transfer:');
			console.error('Error type:', typeof error);
			console.error('Error:', error);
			if (error.stack) {
				console.error('Stack trace:', error.stack);
			}
			process.exit(1);
		}

		client.close();
		return;
	} else {
		console.error('ERROR: No action specified');
		showHelp();
		process.exit(1);
	}

	console.log(`\n${description}...`);

	const gasResult = await estimateGas(env, contractId, iface, operatorId, functionName, fnParams, 200_000);
	const gasLimit = userGas || gasResult.gasLimit;

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

async function showContractInfo(env, contractId, operatorId, iface, jsonOutput = false) {
	// Get admins
	let encodedCommand = iface.encodeFunctionData('getAdmins', []);
	let result = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand, operatorId, false);
	const admins = iface.decodeFunctionResult('getAdmins', result)[0];
	const adminList = admins.map(admin => AccountId.fromEvmAddress(0, 0, admin).toString());

	// Get paused status
	encodedCommand = iface.encodeFunctionData('paused', []);
	result = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand, operatorId, false);
	const paused = iface.decodeFunctionResult('paused', result)[0];

	// Get graveyard
	encodedCommand = iface.encodeFunctionData('graveyard', []);
	result = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand, operatorId, false);
	const graveyardAddr = iface.decodeFunctionResult('graveyard', result)[0];
	const graveyardId = graveyardAddr === '0x0000000000000000000000000000000000000000'
		? null
		: AccountId.fromEvmAddress(0, 0, graveyardAddr).toString();

	// Get output tokens
	encodedCommand = iface.encodeFunctionData('getOutputTokens', []);
	result = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand, operatorId, false);
	const outputTokens = iface.decodeFunctionResult('getOutputTokens', result)[0];
	const outputTokenList = outputTokens.map(token => AccountId.fromEvmAddress(0, 0, token).toString());

	// Get HBAR balance
	let hbarBalance = null;
	try {
		hbarBalance = await checkMirrorHbarBalance(env, contractId);
	} catch {
		// Mirror node query failed, balance unknown
	}

	// Get graveyard approval count
	let graveyardApprovalCount = null;
	try {
		encodedCommand = iface.encodeFunctionData('getGraveyardApprovalCount', []);
		result = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand, operatorId, false);
		graveyardApprovalCount = Number(iface.decodeFunctionResult('getGraveyardApprovalCount', result)[0]);
	} catch {
		// May not be available on older contract versions
	}

	if (jsonOutput) {
		console.log(JSON.stringify({
			contract: contractId.toString(),
			admins: adminList,
			paused,
			graveyard: graveyardId,
			graveyardApprovalCount: graveyardApprovalCount !== null ? graveyardApprovalCount : 'unknown',
			outputTokens: outputTokenList,
			hbarBalance: hbarBalance !== null ? hbarBalance : 'unknown',
		}));
	} else {
		console.log('\n=== Contract Info ===\n');

		console.log('Admins:');
		for (const admin of adminList) {
			console.log(`  - ${admin}`);
		}

		console.log(`\nPaused: ${paused}`);

		if (graveyardId) {
			console.log(`Graveyard: ${graveyardId}`);
			if (graveyardApprovalCount !== null) {
				console.log(`Graveyard Approvals: ${graveyardApprovalCount} token(s) approved`);
				if (graveyardApprovalCount >= 90) {
					console.log('  WARNING: Approaching Hedera 100-allowance limit!');
				}
			}
		} else {
			console.log('Graveyard: Not configured');
		}

		if (hbarBalance !== null) {
			const hbarFormatted = (hbarBalance / 100_000_000).toFixed(4);
			console.log(`\nHBAR Balance: ${hbarFormatted} HBAR (${hbarBalance} tinybars)`);
		} else {
			console.log('\nHBAR Balance: (unable to query)');
		}

		console.log('\nOutput Tokens:');
		if (outputTokenList.length === 0) {
			console.log('  (none configured)');
		} else {
			for (const token of outputTokenList) {
				console.log(`  - ${token}`);
			}
		}
	}
}

main()
	.then(() => process.exit(0))
	.catch((error) => {
		console.error('ERROR:', error.message || error);
		process.exit(1);
	});
