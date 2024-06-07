const {
	ContractId,
	AccountId,
	TokenId,
} = require('@hashgraph/sdk');
require('dotenv').config();
const fs = require('fs');
const { getArgFlag } = require('../../utils/nodeHelpers');
const { ethers } = require('ethers');
const { readOnlyEVMFromMirrorNode } = require('../../utils/solidityHelpers');

const env = process.env.ENVIRONMENT ?? null;
const contractName = 'FallbackTokenSwap';

const main = async () => {
	const args = process.argv.slice(2);
	if (args.length != 3 || getArgFlag('h')) {
		console.log('Usage: checkConfigForTokens.js 0.0.CCC 0.0.XXX,0.0.YYY X1,X2,X3:Y1,Y2,Y3');
		console.log('		CCC is the swap contractId to check config');
		console.log('		0.0.XXX,0.0.YYY are the tokens to swap in same order as the serials');
		console.log('		X,Y,Z are the serials to swap in same order as the tokenIds delimited by :');
		console.log('example: checkConfigForTokens.js 0.0.123 0.0.456,0.0.789 1,2:3,4');
		return;
	}

	const contractId = ContractId.fromString(args[0]);
	const tokens = args[1].split(',').map((t) => TokenId.fromString(t));
	// create and array of arrays
	const serials = args[2].split(':').map((s) => s.split(','));

	if (tokens.length != serials.length) {
		console.error('Error: Number of tokens and serials do not match');
		return;
	}

	console.log('\n-Using ENIVRONMENT:', env);
	console.log('\n-Checking config for contract:', contractId.toString());

	const hashList = [];
	for (let i = 0; i < tokens.length; i++) {
		console.log('\tToken:', tokens[i].toString(), 'Serial(s):', serials[i].join(','));
		for (let j = 0; j < serials[i].length; j++) {
			hashList.push(ethers.solidityPackedKeccak256(
				['address', 'uint256'],
				[tokens[i].toSolidityAddress(), serials[i][j]],
			));
		}
	}

	// import ABI
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

	// output the mapping of token#Serial -> serial
	console.log('\n-Result:');
	let counter = 0;

	for (let i = 0; i < tokens.length; i++) {
		for (let j = 0; j < serials[i].length; j++) {
			console.log(`\t${tokens[i].toString()}#${serials[i][j]} -> ${Number(decodedResult[0][counter])}`);
			counter++;
		}
		console.log('found:', counter);
	}
};


main()
	.then(() => {
		// eslint-disable-next-line no-useless-escape
		process.exit(0);
	})
	.catch(error => {
		console.error(error);
		process.exit(1);
	});
