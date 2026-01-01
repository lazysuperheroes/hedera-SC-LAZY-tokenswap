const fs = require('fs');
const path = require('path');
const { getArgFlag } = require('../utils/nodeHelpers.cjs');

function showHelp() {
	console.log(`
Usage: node verify-setup.js [options]

Pre-flight check to verify your environment is properly configured for running
Hedera Token Swap scripts.

Options:
  -h, --help      Show this help message
  -v, --verbose   Show detailed output for all checks
  --json          Output results in JSON format

Checks performed:
  - Required environment variables (ACCOUNT_ID, PRIVATE_KEY, ENVIRONMENT)
  - Contract compilation artifacts
  - Node.js version compatibility

Example:
  node verify-setup.js
  node verify-setup.js --verbose
`);
}

const REQUIRED_ENV_VARS = [
	{ name: 'ACCOUNT_ID', description: 'Hedera operator account ID (e.g., 0.0.12345)' },
	{ name: 'PRIVATE_KEY', description: 'ED25519 or ECDSA private key' },
	{ name: 'ENVIRONMENT', description: 'Network environment (TEST, MAIN, PREVIEW, LOCAL)' },
];

const OPTIONAL_ENV_VARS = [
	{ name: 'TOKEN_SWAP_CONTRACT_ID', description: 'NoFallbackTokenSwap contract ID' },
	{ name: 'FALLBACK_TOKEN_SWAP_CONTRACT_ID', description: 'FallbackTokenSwap contract ID' },
	{ name: 'LAZY_GAS_STATION_CONTRACT_ID', description: 'LazyGasStation contract ID' },
	{ name: 'LAZY_TOKEN_ID', description: 'LAZY token ID' },
	{ name: 'SWAP_TOKEN_ID', description: 'Token being swapped for LAZY' },
];

const REQUIRED_ARTIFACTS = [
	'NoFallbackTokenSwap',
	'FallbackTokenSwap',
	'LazyGasStation',
];

const VALID_ENVIRONMENTS = ['TEST', 'MAIN', 'PREVIEW', 'LOCAL'];

function checkEnvVar(name, _required = true) {
	const value = process.env[name];
	if (value) {
		// Mask sensitive values
		if (name === 'PRIVATE_KEY') {
			return { exists: true, value: value.substring(0, 8) + '...' + value.substring(value.length - 4) };
		}
		return { exists: true, value };
	}
	return { exists: false, value: null };
}

function checkArtifact(contractName) {
	const artifactPath = path.join(
		process.cwd(),
		'artifacts',
		'contracts',
		`${contractName}.sol`,
		`${contractName}.json`,
	);

	if (fs.existsSync(artifactPath)) {
		try {
			const content = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
			return {
				exists: true,
				hasAbi: Array.isArray(content.abi) && content.abi.length > 0,
				hasBytecode: !!content.bytecode && content.bytecode.length > 2,
			};
		} catch {
			return { exists: true, hasAbi: false, hasBytecode: false, error: 'Invalid JSON' };
		}
	}
	return { exists: false };
}

function checkNodeVersion() {
	const version = process.version;
	const major = parseInt(version.slice(1).split('.')[0], 10);
	return {
		version,
		supported: major >= 18,
		major,
	};
}

function validateAccountId(accountId) {
	const regex = /^\d+\.\d+\.\d+$/;
	return regex.test(accountId);
}

function validateEnvironment(env) {
	return VALID_ENVIRONMENTS.includes(env?.toUpperCase());
}

const main = async () => {
	if (getArgFlag('h') || getArgFlag('help')) {
		showHelp();
		process.exit(0);
	}

	const verbose = getArgFlag('v') || getArgFlag('verbose');
	const jsonOutput = getArgFlag('json');
	let hasErrors = false;
	let hasWarnings = false;

	// Data collectors for JSON output
	const jsonData = {
		nodeVersion: {},
		requiredEnvVars: {},
		optionalEnvVars: {},
		artifacts: {},
		configFiles: {},
		summary: {},
	};

	if (!jsonOutput) {
		console.log('\n=== Hedera Token Swap - Environment Verification ===\n');
	}

	// Check Node.js version
	if (!jsonOutput) console.log('1. Node.js Version Check');
	const nodeCheck = checkNodeVersion();
	jsonData.nodeVersion = { ...nodeCheck, status: nodeCheck.supported ? 'ok' : 'error' };
	if (!jsonOutput) {
		if (nodeCheck.supported) {
			console.log(`   [OK] Node.js ${nodeCheck.version} (>= v18 required)`);
		} else {
			console.log(`   [ERROR] Node.js ${nodeCheck.version} - v18 or higher required`);
		}
	}
	if (!nodeCheck.supported) hasErrors = true;

	// Check required environment variables
	if (!jsonOutput) console.log('\n2. Required Environment Variables');
	for (const envVar of REQUIRED_ENV_VARS) {
		const check = checkEnvVar(envVar.name);
		let status = 'ok';
		let error = null;

		if (check.exists) {
			if (envVar.name === 'ACCOUNT_ID' && !validateAccountId(check.value)) {
				status = 'error';
				error = 'Invalid format (expected X.X.X)';
				hasErrors = true;
				if (!jsonOutput) console.log(`   [ERROR] ${envVar.name}: ${error}`);
			} else if (envVar.name === 'ENVIRONMENT' && !validateEnvironment(check.value)) {
				status = 'error';
				error = `Invalid value "${check.value}" (expected: ${VALID_ENVIRONMENTS.join(', ')})`;
				hasErrors = true;
				if (!jsonOutput) console.log(`   [ERROR] ${envVar.name}: ${error}`);
			} else if (!jsonOutput) {console.log(`   [OK] ${envVar.name}: ${check.value}`);}
		} else {
			status = 'error';
			error = `Not set - ${envVar.description}`;
			hasErrors = true;
			if (!jsonOutput) console.log(`   [ERROR] ${envVar.name}: ${error}`);
		}

		jsonData.requiredEnvVars[envVar.name] = { ...check, status, error };
	}

	// Check optional environment variables
	if (!jsonOutput) console.log('\n3. Optional Environment Variables');
	for (const envVar of OPTIONAL_ENV_VARS) {
		const check = checkEnvVar(envVar.name, false);
		jsonData.optionalEnvVars[envVar.name] = { ...check, status: check.exists ? 'ok' : 'not_set' };
		if (!jsonOutput) {
			if (check.exists) {
				console.log(`   [OK] ${envVar.name}: ${check.value}`);
			} else if (verbose) {
				console.log(`   [--] ${envVar.name}: Not set (optional)`);
			}
		}
	}
	if (!jsonOutput && !verbose) {
		const setCount = OPTIONAL_ENV_VARS.filter(v => process.env[v.name]).length;
		if (setCount < OPTIONAL_ENV_VARS.length) {
			console.log(`   [--] ${OPTIONAL_ENV_VARS.length - setCount} optional variables not set (use --verbose to see)`);
		}
	}

	// Check contract artifacts
	if (!jsonOutput) console.log('\n4. Contract Artifacts');
	for (const contractName of REQUIRED_ARTIFACTS) {
		const check = checkArtifact(contractName);
		let status = 'ok';

		if (check.exists && check.hasAbi && check.hasBytecode) {
			if (!jsonOutput) console.log(`   [OK] ${contractName}: Compiled`);
		} else if (check.exists) {
			status = 'warning';
			hasWarnings = true;
			if (!jsonOutput) console.log(`   [WARN] ${contractName}: Artifact exists but may be incomplete`);
		} else {
			status = 'warning';
			hasWarnings = true;
			if (!jsonOutput) console.log(`   [WARN] ${contractName}: Not compiled - run 'npx hardhat compile'`);
		}

		jsonData.artifacts[contractName] = { ...check, status };
	}

	// Check .env file exists
	if (!jsonOutput) console.log('\n5. Configuration Files');
	const envPath = path.join(process.cwd(), '.env');
	const envFileExists = fs.existsSync(envPath);
	jsonData.configFiles.envFile = { exists: envFileExists, status: envFileExists ? 'ok' : 'warning' };
	if (!jsonOutput) {
		if (envFileExists) {
			console.log('   [OK] .env file exists');
		} else {
			console.log('   [WARN] .env file not found - using system environment variables');
		}
	}
	if (!envFileExists) hasWarnings = true;

	// Summary
	let summaryStatus = 'passed';
	if (hasErrors) {
		summaryStatus = 'failed';
	} else if (hasWarnings) {
		summaryStatus = 'passed_with_warnings';
	}

	jsonData.summary = { status: summaryStatus, hasErrors, hasWarnings };

	if (jsonOutput) {
		console.log(JSON.stringify(jsonData, null, 2));
	} else {
		console.log('\n=== Summary ===');
		if (hasErrors) {
			console.log('\n[FAILED] Environment verification failed. Please fix the errors above.\n');
		} else if (hasWarnings) {
			console.log('\n[PASSED WITH WARNINGS] Environment is mostly configured. Review warnings above.\n');
		} else {
			console.log('\n[PASSED] Environment is properly configured. Ready to run scripts!\n');
		}
	}

	process.exit(hasErrors ? 1 : 0);
};

// Load .env if it exists
try {
	require('dotenv').config();
} catch {
	// dotenv not required if environment variables are set directly
}

main().catch(error => {
	console.error('ERROR:', error.message || error);
	process.exit(1);
});
