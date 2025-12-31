const {
	Client,
	AccountId,
	PrivateKey,
} = require('@hashgraph/sdk');

require('dotenv').config();

/**
 * Detect key type from DER prefix
 * @param {string} keyString - Private key string
 * @returns {'ED25519'|'ECDSA'|'UNKNOWN'} Key type
 */
function detectKeyType(keyString) {
	if (keyString.startsWith('302e')) {
		return 'ED25519';
	} else if (keyString.startsWith('3030')) {
		return 'ECDSA';
	}
	return 'UNKNOWN';
}

/**
 * Load private key with auto-detection of key type
 * @param {string} keyString - Private key string from .env
 * @returns {PrivateKey} Hedera PrivateKey instance
 */
function loadPrivateKey(keyString) {
	const keyType = detectKeyType(keyString);

	if (keyType === 'ED25519') {
		return PrivateKey.fromStringED25519(keyString);
	} else if (keyType === 'ECDSA') {
		return PrivateKey.fromStringECDSA(keyString);
	} else {
		// Try DER format as fallback (auto-detect)
		try {
			return PrivateKey.fromStringDer(keyString);
		} catch {
			// Last resort - try ED25519
			return PrivateKey.fromStringED25519(keyString);
		}
	}
}

/**
 * Load operator credentials from environment variables
 * @returns {{ operatorId: AccountId, operatorKey: PrivateKey }}
 * @throws {Error} If PRIVATE_KEY or ACCOUNT_ID are missing
 */
function loadOperator() {
	const privateKeyStr = process.env.PRIVATE_KEY;
	const accountIdStr = process.env.ACCOUNT_ID;

	if (!privateKeyStr || !accountIdStr) {
		console.error('ERROR: Must specify PRIVATE_KEY & ACCOUNT_ID in the .env file');
		console.error('');
		console.error('Required in .env:');
		console.error('  ACCOUNT_ID=0.0.XXXXX');
		console.error('  PRIVATE_KEY=<your-private-key>');
		console.error('');
		console.error('See .env.example for a template.');
		process.exit(1);
	}

	try {
		const operatorKey = loadPrivateKey(privateKeyStr);
		const operatorId = AccountId.fromString(accountIdStr);
		return { operatorId, operatorKey };
	} catch (err) {
		console.error('ERROR: Invalid PRIVATE_KEY or ACCOUNT_ID format');
		console.error('Details:', err.message);
		process.exit(1);
	}
}

/**
 * Create and configure Hedera client for the specified environment
 * @param {string} env - Environment: TEST, MAIN, PREVIEW, or LOCAL
 * @param {AccountId} operatorId - Operator account ID
 * @param {PrivateKey} operatorKey - Operator private key
 * @returns {Client} Configured Hedera client
 */
function createClient(env, operatorId, operatorKey) {
	const envUpper = (env || 'TEST').toUpperCase();
	let client;

	switch (envUpper) {
	case 'TEST':
	case 'TESTNET':
		client = Client.forTestnet();
		console.log('Operating in *TESTNET*');
		break;
	case 'MAIN':
	case 'MAINNET':
		client = Client.forMainnet();
		console.log('Operating in *MAINNET*');
		break;
	case 'PREVIEW':
	case 'PREVIEWNET':
		client = Client.forPreviewnet();
		console.log('Operating in *PREVIEWNET*');
		break;
	case 'LOCAL':
		// eslint-disable-next-line no-case-declarations
		const node = { '127.0.0.1:50211': new AccountId(3) };
		client = Client.forNetwork(node).setMirrorNetwork('127.0.0.1:5600');
		console.log('Operating in *LOCAL*');
		break;
	default:
		console.error(`ERROR: Invalid environment "${env}"`);
		console.error('Valid options: TEST, MAIN, PREVIEW, LOCAL');
		process.exit(1);
	}

	client.setOperator(operatorId, operatorKey);
	return client;
}

/**
 * Initialize Hedera client with operator credentials from environment
 * This is the main convenience function - use this in most scripts
 *
 * @returns {{ client: Client, operatorId: AccountId, operatorKey: PrivateKey, env: string }}
 *
 * @example
 * const { initializeClient } = require('./utils/clientFactory.cjs');
 * const { client, operatorId, operatorKey, env } = initializeClient();
 */
function initializeClient() {
	const env = process.env.ENVIRONMENT || 'TEST';
	const { operatorId, operatorKey } = loadOperator();
	const client = createClient(env, operatorId, operatorKey);

	console.log('-Using Operator:', operatorId.toString());
	console.log('-Using Environment:', env.toUpperCase());

	return { client, operatorId, operatorKey, env };
}

/**
 * Validate that required environment variables are set
 * Use this for early validation before expensive operations
 *
 * @param {string[]} required - Array of required env var names
 * @returns {boolean} True if all required vars are set
 */
function validateEnvVars(required) {
	const missing = required.filter(name => !process.env[name]);

	if (missing.length > 0) {
		console.error('ERROR: Missing required environment variables:');
		missing.forEach(name => console.error(`  - ${name}`));
		console.error('');
		console.error('Please check your .env file.');
		return false;
	}

	return true;
}

module.exports = {
	detectKeyType,
	loadPrivateKey,
	loadOperator,
	createClient,
	initializeClient,
	validateEnvVars,
};
