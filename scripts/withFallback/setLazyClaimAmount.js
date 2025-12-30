const {
	ContractId,
} = require('@hashgraph/sdk');
const fs = require('fs');
const { ethers } = require('ethers');
const readlineSync = require('readline-sync');
const { getArgFlag } = require('../../utils/nodeHelpers');
const { contractExecuteFunction, readOnlyEVMFromMirrorNode } = require('../../utils/solidityHelpers');
const { initializeClient } = require('../../utils/clientFactory');

const contractName = 'FallbackTokenSwap';

function showHelp() {
	console.log(`
Usage: node setLazyClaimAmount.js <contract-id> <amount>

Update the $LAZY claim amount on a FallbackTokenSwap contract.

Arguments:
  <contract-id>    Contract ID to update (e.g., 0.0.123456)
  <amount>         New $LAZY amount per claim (include decimal)

Options:
  -h, --help    Show this help message

Example:
  node setLazyClaimAmount.js 0.0.123456 10

  Sets the claim amount to 10 (which is 1 $LAZY with 1 decimal)
`);
}

const main = async () => {
	const args = process.argv.slice(2).filter(arg => !arg.startsWith('-'));

	if (args.length != 2 || getArgFlag('h') || getArgFlag('help')) {
		showHelp();
		process.exit(args.length === 2 ? 0 : 1);
	}

	// Initialize client using clientFactory
	const { client, operatorId, env } = initializeClient();

	const contractId = ContractId.fromString(args[0]);
	const newAmount = Number(args[1]);

	console.log('\n-Using Contract:', contractId.toString());

	// Import ABI
	const json = JSON.parse(fs.readFileSync(`./artifacts/contracts/${contractName}.sol/${contractName}.json`, 'utf8'));
	const nfbtsIface = new ethers.Interface(json.abi);

	const encodedCommand = nfbtsIface.encodeFunctionData('lazyPmtAmt', []);

	let resObj = await readOnlyEVMFromMirrorNode(
		env,
		contractId,
		encodedCommand,
		operatorId,
		false,
	);

	const currentAmount = nfbtsIface.decodeFunctionResult('lazyPmtAmt', resObj);

	console.log('Current setting:', Number(currentAmount[0]));

	const proceed = readlineSync.keyInYNStrict('Do you want to update the amount of $LAZY given: ' + newAmount + '?');
	if (!proceed) {
		console.log('User Aborted');
		process.exit(0);
	}

	resObj = await contractExecuteFunction(
		contractId,
		nfbtsIface,
		client,
		null,
		'updateClaimAmount',
		[newAmount],
	);

	console.log('Contract updated:', resObj[0]?.status?.toString(), 'txId:', resObj[2]?.transactionId?.toString());
};

main()
	.then(() => process.exit(0))
	.catch(error => {
		console.error('ERROR:', error.message || error);
		process.exit(1);
	});
