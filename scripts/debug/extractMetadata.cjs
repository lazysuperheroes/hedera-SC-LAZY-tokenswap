#!/usr/bin/env node
/**
 * Extract Solidity compiler metadata for contract verification
 *
 * This script extracts the metadata JSON from build-info files.
 * The metadata is needed by some verification tools like HashScan.
 */

const fs = require('fs');
const path = require('path');

// Configuration - Contracts to extract metadata for
const CONTRACTS = [
	{
		name: 'UnifiedTokenSwap',
		file: 'contracts/UnifiedTokenSwap.sol',
	},
	{
		name: 'NoFallbackTokenSwap',
		file: 'contracts/NoFallbackTokenSwap.sol',
	},
	{
		name: 'FallbackTokenSwap',
		file: 'contracts/FallbackTokenSwap.sol',
	},
];

const BUILD_INFO_DIR = path.join(__dirname, '../../artifacts/build-info');
const OUTPUT_DIR = path.join(__dirname, '../../artifacts/metadata');

/**
 * Extract metadata for a single contract
 */
function extractContractMetadata(compilationOutput, contractName, contractFile) {
	const contractKey = `project/${contractFile}`;

	if (!compilationOutput.contracts || !compilationOutput.contracts[contractKey]) {
		console.error(`❌ Contract not found: ${contractKey}`);
		return false;
	}

	const contractOutput = compilationOutput.contracts[contractKey][contractName];

	if (!contractOutput) {
		console.error(`❌ Contract artifact not found: ${contractName}`);
		return false;
	}

	// Check if metadata exists
	if (!contractOutput.metadata) {
		console.error(`❌ No metadata field found for ${contractName}`);
		return false;
	}

	// The metadata is stored as a JSON string, parse it
	const metadataString = contractOutput.metadata;
	const metadata = JSON.parse(metadataString);

	// Save metadata as formatted JSON
	const metadataPath = path.join(OUTPUT_DIR, `${contractName}.metadata.json`);
	fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));

	// Also save the raw metadata string (sometimes needed)
	const rawMetadataPath = path.join(OUTPUT_DIR, `${contractName}.metadata-raw.txt`);
	fs.writeFileSync(rawMetadataPath, metadataString);

	console.log(`✅ ${contractName}`);
	console.log(`   JSON: ${path.relative(process.cwd(), metadataPath)}`);
	console.log(`   Raw: ${path.relative(process.cwd(), rawMetadataPath)}`);
	console.log(`   Size: ${(metadataString.length / 1024).toFixed(2)} KB`);
	console.log(`   Compiler: ${metadata.compiler.version} | EVM: ${metadata.settings.evmVersion} | Optimizer: ${metadata.settings.optimizer.runs} runs`);
	console.log('');

	return true;
}

/**
 * Extract metadata from build-info output for all configured contracts
 */
function extractMetadata() {
	console.log('🔍 Extracting contract metadata...\n');

	// Create output directory
	if (!fs.existsSync(OUTPUT_DIR)) {
		fs.mkdirSync(OUTPUT_DIR, { recursive: true });
	}

	// Find the .output.json file (Hardhat v3 format)
	const files = fs.readdirSync(BUILD_INFO_DIR);
	const outputFile = files.find(f => f.endsWith('.output.json'));

	if (!outputFile) {
		console.error('❌ No .output.json file found in build-info directory');
		console.log('   Looking for: artifacts/build-info/*.output.json');
		return;
	}

	console.log(`📄 Reading: ${outputFile}\n`);
	const buildInfoPath = path.join(BUILD_INFO_DIR, outputFile);
	const buildInfo = JSON.parse(fs.readFileSync(buildInfoPath, 'utf8'));

	// Navigate to the contract's compilation output
	// The .output.json file wraps the actual output in an 'output' field
	const compilationOutput = buildInfo.output || buildInfo;

	// Extract metadata for each configured contract
	let successCount = 0;
	let failCount = 0;

	for (const contract of CONTRACTS) {
		const success = extractContractMetadata(
			compilationOutput,
			contract.name,
			contract.file,
		);
		if (success) {
			successCount++;
		} else {
			failCount++;
		}
	}

	// Summary
	console.log('─'.repeat(60));
	console.log(`📦 Summary: ${successCount} succeeded, ${failCount} failed`);
	if (successCount > 0) {
		console.log(`📁 Output directory: ${path.relative(process.cwd(), OUTPUT_DIR)}`);
	}
}

// Run extraction
try {
	extractMetadata();
} catch (error) {
	console.error('\n❌ Error extracting metadata:', error.message);
	process.exit(1);
}
