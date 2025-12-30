const {
	ContractId,
	AccountId,
	TokenId,
} = require('@hashgraph/sdk');
const fs = require('fs');
const { getArgFlag } = require('../../utils/nodeHelpers');
const { ethers } = require('ethers');
const { readOnlyEVMFromMirrorNode } = require('../../utils/solidityHelpers');
const { initializeClient } = require('../../utils/clientFactory');

const contractName = 'FallbackTokenSwap';

function showHelp() {
	console.log(`
Usage: node checkConfigForTokens.js <contract-id> <tokens> <serials>

Check swap configuration for specific tokens on a FallbackTokenSwap contract.

Arguments:
  <contract-id>    Contract ID to check (e.g., 0.0.123456)
  <tokens>         Comma-separated token IDs (e.g., 0.0.XXX,0.0.YYY)
  <serials>        Colon-delimited serial groups matching tokens (e.g., 1,2:3,4)

Options:
  -h, --help    Show this help message
  --json        Output results in JSON format

Example:
  node checkConfigForTokens.js 0.0.123 0.0.456,0.0.789 1,2:3,4

  This checks serials 1,2 from token 0.0.456 and serials 3,4 from token 0.0.789
`);
}

const main = async () => {
	const args = process.argv.slice(2).filter(arg => !arg.startsWith('-'));
	const jsonOutput = getArgFlag('json');

	if (args.length != 3 || getArgFlag('h') || getArgFlag('help')) {
		showHelp();
		process.exit(args.length === 3 ? 0 : 1);
	}

	// Initialize client to get env (client not needed for read-only)
	const { env } = initializeClient();

	const contractId = ContractId.fromString(args[0]);
	const tokens = args[1].split(',').map((t) => TokenId.fromString(t));
	const serials = args[2].split(':').map((s) => s.split(','));

	if (tokens.length != serials.length) {
		if (jsonOutput) {
			console.log(JSON.stringify({ error: 'Number of tokens and serials do not match' }));
		} else {
			console.error('ERROR: Number of tokens and serials do not match');
		}
		process.exit(1);
	}

	if (!jsonOutput) {
		console.log('\n-Checking config for contract:', contractId.toString());
	}

	const hashList = [];
	for (let i = 0; i < tokens.length; i++) {
		if (!jsonOutput) {
			console.log('\tToken:', tokens[i].toString(), 'Serial(s):', serials[i].join(','));
		}
		for (let j = 0; j < serials[i].length; j++) {
			hashList.push(ethers.solidityPackedKeccak256(
				['address', 'uint256'],
				[tokens[i].toSolidityAddress(), serials[i][j]],
			));
		}
	}

	// Import ABI
	const json = JSON.parse(fs.readFileSync(`./artifacts/contracts/${contractName}.sol/${contractName}.json`, 'utf8'));
	const nfbtsIface = new ethers.Interface(json.abi);

	const encodedCommand = nfbtsIface.encodeFunctionData('getSerials', [hashList]);

	const result = await readOnlyEVMFromMirrorNode(
		env,
		contractId,
		encodedCommand,
		AccountId.fromString('0.0.1000'),
		false,
	);

	const decodedResult = nfbtsIface.decodeFunctionResult('getSerials', result);

	// Output the mapping of token#Serial -> serial
	let counter = 0;
	const results = [];

	for (let i = 0; i < tokens.length; i++) {
		for (let j = 0; j < serials[i].length; j++) {
			const mapping = {
				token: tokens[i].toString(),
				inputSerial: Number(serials[i][j]),
				outputSerial: Number(decodedResult[0][counter]),
			};
			results.push(mapping);
			counter++;
		}
	}

	if (jsonOutput) {
		console.log(JSON.stringify({
			contract: contractId.toString(),
			mappings: results,
		}, null, 2));
	} else {
		console.log('\n-Result:');
		for (const r of results) {
			console.log(`\t${r.token}#${r.inputSerial} -> ${r.outputSerial}`);
		}
		console.log('found:', results.length);
	}
};

main()
	.then(() => process.exit(0))
	.catch(error => {
		console.error('ERROR:', error.message || error);
		process.exit(1);
	});
