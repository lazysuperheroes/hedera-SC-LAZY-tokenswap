/**
 * Convert Hardhat v3 build-info artifacts to v2 format for HashScan verification
 *
 * Usage: node scripts/debug/convertBuildInfoToV2.cjs
 *
 * This creates v2-compatible versions of build-info files in a new directory:
 * artifacts/build-info-v2/
 */

const fs = require('fs');
const path = require('path');

const BUILD_INFO_DIR = path.join(__dirname, '../../artifacts/build-info');
const OUTPUT_DIR = path.join(__dirname, '../../artifacts/build-info-v2');

/**
 * Convert Hardhat v3 build-info to v2 format
 */
function convertV3toV2(v3BuildInfo) {
	const v2BuildInfo = {
		_format: 'hh-sol-build-info-1', // Change from hh3 to hh
		solcVersion: v3BuildInfo.solcVersion,
		solcLongVersion: v3BuildInfo.solcLongVersion,
		input: { ...v3BuildInfo.input },
	};

	// Remove the userSourceNameMap (v3 only)
	delete v2BuildInfo.id;

	// Transform source paths from v3 to v2 format
	if (v2BuildInfo.input.sources) {
		const transformedSources = {};

		for (const [sourcePath, sourceData] of Object.entries(v2BuildInfo.input.sources)) {
			// Remove "npm/@" prefix and convert to simpler node_modules path
			let v2Path = sourcePath;

			if (sourcePath.startsWith('npm/@')) {
				// Convert: npm/@openzeppelin/contracts@5.4.0/access/Ownable.sol
				// To: @openzeppelin/contracts/access/Ownable.sol
				v2Path = sourcePath.replace(/^npm\/@([^/]+)\/([^@]+)@[\d.]+\//, '@$1/$2/');
			}

			transformedSources[v2Path] = sourceData;
		}

		v2BuildInfo.input.sources = transformedSources;
	}

	// Add the output field (copy from the separate .output.json file if it exists)
	return v2BuildInfo;
}

/**
 * Remove v3-specific solc version prefix from filename
 */
function getV2Filename(v3Filename) {
	// Remove "solc-0_8_24-" prefix to get just the hash
	return v3Filename.replace(/^solc-[\d_]+-/, '');
}

function main() {
	console.log('Converting Hardhat v3 build-info to v2 format...\n');

	// Create output directory if it doesn't exist
	if (!fs.existsSync(OUTPUT_DIR)) {
		fs.mkdirSync(OUTPUT_DIR, { recursive: true });
	}

	// Get all .json files in build-info directory (excluding .output.json)
	const files = fs.readdirSync(BUILD_INFO_DIR)
		.filter(f => f.endsWith('.json') && !f.endsWith('.output.json'));

	if (files.length === 0) {
		console.log('No build-info files found. Run `npx hardhat compile` first.');
		return;
	}

	for (const filename of files) {
		const inputPath = path.join(BUILD_INFO_DIR, filename);
		const v3BuildInfo = JSON.parse(fs.readFileSync(inputPath, 'utf8'));

		// Convert to v2 format
		const v2BuildInfo = convertV3toV2(v3BuildInfo);

		// Try to load and merge the output file
		const outputFilename = filename.replace('.json', '.output.json');
		const outputPath = path.join(BUILD_INFO_DIR, outputFilename);

		if (fs.existsSync(outputPath)) {
			const outputData = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
			v2BuildInfo.output = outputData;
			console.log(`✓ Merged output data for ${filename}`);
		} else {
			console.log(`⚠ No output file found for ${filename}`);
		}

		// Generate v2-style filename (without solc version prefix)
		const v2Filename = getV2Filename(filename);
		const outputFilePath = path.join(OUTPUT_DIR, v2Filename);

		// Write the converted file
		fs.writeFileSync(outputFilePath, JSON.stringify(v2BuildInfo, null, 2));
		console.log(`✓ Converted: ${filename} → ${v2Filename}`);
	}

	console.log('\n✅ Conversion complete!');
	console.log(`📁 V2 build-info files saved to: ${OUTPUT_DIR}`);
	console.log('\nYou can now use these files for HashScan verification.');
}

main();
