const {
	Client,
	AccountId,
	PrivateKey,
	ContractCreateFlow,
	ContractFunctionParameters,
	TokenId,
} = require('@hashgraph/sdk');
const fs = require('fs');
const readlineSync = require('readline-sync');

require('dotenv').config();

// Get operator from .env file
const operatorKey = PrivateKey.fromString(process.env.PRIVATE_KEY);
const operatorId = AccountId.fromString(process.env.ACCOUNT_ID);
const contractName = process.env.CONTRACT_NAME ?? null;
const env = process.env.ENVIRONMENT ?? null;

const newToken = TokenId.fromString(process.env.SWAP_TOKEN) ?? null;
const tokenTreasury = AccountId.fromString(process.env.TOKEN_TREASURY) ?? null;
const lazySCT = AccountId.fromString(process.env.LAZY_CONTRACT) ?? null;
const lazyToken = TokenId.fromString(process.env.LAZY_TOKEN) ?? null;

let client;

async function contractDeployFcn(bytecode, gasLim) {
	const contractCreateTx = new ContractCreateFlow()
		.setBytecode(bytecode)
		.setGas(gasLim)
		.setConstructorParameters(
			new ContractFunctionParameters()
				.addAddress(newToken.toSolidityAddress())
				.addAddress(tokenTreasury.toSolidityAddress())
				.addAddress(lazySCT.toSolidityAddress())
				.addAddress(lazyToken.toSolidityAddress()),
		);
	const contractCreateSubmit = await contractCreateTx.execute(client);
	const contractCreateRx = await contractCreateSubmit.getReceipt(client);
	const contractId = contractCreateRx.contractId;
	const contractAddress = contractId.toSolidityAddress();
	return [contractId, contractAddress];
}

const main = async () => {
	if (contractName === undefined || contractName == null) {
		console.log('Environment required, please specify CONTRACT_NAME for ABI in the .env file');
		return;
	}


	console.log('\n-Using ENIVRONMENT:', env);
	console.log('\n-Using Operator:', operatorId.toString());
	console.log('\n-Deploying Contract:', contractName);
	console.log('\n-Using LSCT:', lazySCT.toString());
	console.log('\n-Using LazyToken:', lazyToken.toString());
	console.log('\nUsing New Token:', newToken.toString());
	console.log('\nUsing Old Token Treasury:', tokenTreasury.toString());

	if (env.toUpperCase() == 'TEST') {
		client = Client.forTestnet();
		console.log('deploying in *TESTNET*');
	}
	else if (env.toUpperCase() == 'MAIN') {
		client = Client.forMainnet();
		console.log('deploying in *MAINNET*');
	}
	else {
		console.log('ERROR: Must specify either MAIN or TEST as environment in .env file');
		return;
	}

	client.setOperator(operatorId, operatorKey);

	const json = JSON.parse(fs.readFileSync(`./artifacts/contracts/${contractName}.sol/${contractName}.json`));

	const contractBytecode = json.bytecode;

	const execute = readlineSync.keyInYNStrict('Do wish to deploy?');
	if (execute) {
		console.log('\n- Deploying contract...', contractName);
		const gasLimit = 1_800_000;

		const [contractId, contractAddress] = await contractDeployFcn(contractBytecode, gasLimit);

		console.log(`Contract created with ID: ${contractId} / ${contractAddress}`);
	}
	else {
		console.log('Aborting deployment');
	}

};

main()
	.then(() => process.exit(0))
	.catch(error => {
		console.error(error);
		process.exit(1);
	});
