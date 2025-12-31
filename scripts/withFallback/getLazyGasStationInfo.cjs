const {
	AccountId,
	ContractId,
} = require('@hashgraph/sdk');
const fs = require('fs');
const { ethers } = require('ethers');
const { readOnlyEVMFromMirrorNode } = require('../../utils/solidityHelpers.cjs');
const { getArgFlag } = require('../../utils/nodeHelpers.cjs');
const { initializeClient } = require('../../utils/clientFactory.cjs');

const contractName = 'LazyGasStation';

function showHelp() {
	console.log(`
Usage: node getLazyGasStationInfo.js <lgs-id>

Query and display LazyGasStation configuration (admins, authorizers, contract users).

Arguments:
  <lgs-id>    LazyGasStation contract ID (e.g., 0.0.123456)

Options:
  -h, --help    Show this help message
  --json        Output results in JSON format

Example:
  node getLazyGasStationInfo.js 0.0.123456
`);
}

const main = async () => {
	const args = process.argv.slice(2).filter(arg => !arg.startsWith('-'));
	const jsonOutput = getArgFlag('json');

	if (args.length != 1 || getArgFlag('h') || getArgFlag('help')) {
		showHelp();
		process.exit(args.length === 1 ? 0 : 1);
	}

	// Initialize client to get env (client not needed for read-only)
	const { operatorId, env } = initializeClient();

	const contractId = ContractId.fromString(args[0]);

	if (!jsonOutput) {
		console.log('\n-Using Contract:', contractId.toString());
	}

	// Import ABI
	const lgsJSON = JSON.parse(
		fs.readFileSync(
			`./artifacts/contracts/${contractName}.sol/${contractName}.json`,
		),
	);

	const lgsIface = new ethers.Interface(lgsJSON.abi);

	// Query the EVM via mirror node
	// 1) getAdmins
	let encodedCommand = lgsIface.encodeFunctionData('getAdmins', []);

	let result = await readOnlyEVMFromMirrorNode(
		env,
		contractId,
		encodedCommand,
		operatorId,
		false,
	);

	const admins = lgsIface.decodeFunctionResult('getAdmins', result);
	const adminsList = admins[0].map((a) => AccountId.fromEvmAddress(0, 0, a).toString());

	// 2) getAuthorizers
	encodedCommand = lgsIface.encodeFunctionData('getAuthorizers', []);

	result = await readOnlyEVMFromMirrorNode(
		env,
		contractId,
		encodedCommand,
		operatorId,
		false,
	);

	const authorizers = lgsIface.decodeFunctionResult('getAuthorizers', result);
	const authorizersList = authorizers[0].map((a) => AccountId.fromEvmAddress(0, 0, a).toString());

	// 3) getContractUsers
	encodedCommand = lgsIface.encodeFunctionData('getContractUsers', []);

	result = await readOnlyEVMFromMirrorNode(
		env,
		contractId,
		encodedCommand,
		operatorId,
		false,
	);

	const contractUsers = lgsIface.decodeFunctionResult('getContractUsers', result);
	const contractUsersList = contractUsers[0].map((a) => AccountId.fromEvmAddress(0, 0, a).toString());

	if (jsonOutput) {
		console.log(JSON.stringify({
			contract: contractId.toString(),
			admins: adminsList,
			authorizers: authorizersList,
			contractUsers: contractUsersList,
		}, null, 2));
	} else {
		console.log('Admins:', adminsList.join(', '));
		console.log('Authorizers:', authorizersList.join(', '));
		console.log('Contract Users:', contractUsersList.join(', '));
	}
};

main()
	.then(() => process.exit(0))
	.catch(error => {
		console.error('ERROR:', error.message || error);
		process.exit(1);
	});
