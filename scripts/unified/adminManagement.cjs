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
Usage: node adminManagement.js --contract <id> [action] [options]

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

Options:
  -h, --help              Show this help message
  --gas <amount>          Gas limit (default: 200000)
  --json                  Output result as JSON (for automation, works with --info)

Environment Variables:
  ACCOUNT_ID              Hedera operator account (must be admin)
  PRIVATE_KEY             Operator private key
  ENVIRONMENT             Network (TEST, MAIN, PREVIEW, LOCAL)

Examples:
  node adminManagement.js --contract 0.0.123456 --info
  node adminManagement.js --contract 0.0.123456 --add-admin 0.0.789012
  node adminManagement.js --contract 0.0.123456 --unpause
  node adminManagement.js --contract 0.0.123456 --set-graveyard 0.0.456789
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
	const gasLimit = Number(getArg('gas')) || 200_000;

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

	// Handle --info
	if (getArgFlag('info')) {
		await showContractInfo(env, contractId, operatorId, iface, jsonOutput);
		client.close();
		return;
	}

	// Handle actions
	let functionName;
	let params;
	let description;

	if (getArg('add-admin')) {
		const adminId = AccountId.fromString(getArg('add-admin'));
		functionName = 'addAdmin';
		params = iface.encodeFunctionData(functionName, [adminId.toSolidityAddress()]);
		description = `Adding admin: ${adminId}`;
	} else if (getArg('remove-admin')) {
		const adminId = AccountId.fromString(getArg('remove-admin'));
		functionName = 'removeAdmin';
		params = iface.encodeFunctionData(functionName, [adminId.toSolidityAddress()]);
		description = `Removing admin: ${adminId}`;
	} else if (getArg('set-graveyard')) {
		const graveyardId = ContractId.fromString(getArg('set-graveyard'));
		functionName = 'updateGraveyard';
		params = iface.encodeFunctionData(functionName, [graveyardId.toSolidityAddress()]);
		description = `Setting graveyard: ${graveyardId}`;
	} else if (getArgFlag('pause')) {
		functionName = 'updatePauseStatus';
		params = iface.encodeFunctionData(functionName, [true]);
		description = 'Pausing contract';
	} else if (getArgFlag('unpause')) {
		functionName = 'updatePauseStatus';
		params = iface.encodeFunctionData(functionName, [false]);
		description = 'Unpausing contract';
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

	if (jsonOutput) {
		console.log(JSON.stringify({
			contract: contractId.toString(),
			admins: adminList,
			paused,
			graveyard: graveyardId,
			outputTokens: outputTokenList,
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
		} else {
			console.log('Graveyard: Not configured');
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
