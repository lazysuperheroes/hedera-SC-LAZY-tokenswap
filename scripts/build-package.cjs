/**
 * Build script for lazy-tokenswap-contracts NPM package
 * Extracts ABIs and types for frontend consumption
 */

const fs = require('fs');
const path = require('path');

const DIST_DIR = path.join(__dirname, '..', 'dist');
const ARTIFACTS_DIR = path.join(__dirname, '..', 'artifacts', 'contracts');
const TYPES_DIR = path.join(__dirname, '..', 'types', 'ethers-contracts');

// Contracts to include in the package
const CONTRACTS = [
	'UnifiedTokenSwap',
	'NoFallbackTokenSwap',
	'FallbackTokenSwap',
	'BaseTokenSwap',
];

function ensureDir(dir) {
	if (!fs.existsSync(dir)) {
		fs.mkdirSync(dir, { recursive: true });
	}
}

function extractAbi(contractName) {
	const artifactPath = path.join(
		ARTIFACTS_DIR,
		`${contractName}.sol`,
		`${contractName}.json`,
	);

	if (!fs.existsSync(artifactPath)) {
		console.error(`  [SKIP] ${contractName} - artifact not found`);
		return null;
	}

	const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
	return {
		contractName,
		abi: artifact.abi,
	};
}

function copyTypesDir(srcDir, destDir, contractName) {
	const srcPath = path.join(srcDir, `${contractName}.sol`);
	const destPath = path.join(destDir, `${contractName}.sol`);

	if (!fs.existsSync(srcPath)) {
		console.error(`  [SKIP] ${contractName} types - not found`);
		return false;
	}

	ensureDir(destPath);

	const files = fs.readdirSync(srcPath);
	for (const file of files) {
		const content = fs.readFileSync(path.join(srcPath, file), 'utf8');
		fs.writeFileSync(path.join(destPath, file), content);
	}

	return true;
}

function copyFactoryDir(srcDir, destDir, contractName) {
	const srcPath = path.join(srcDir, 'factories', `${contractName}.sol`);
	const destPath = path.join(destDir, 'factories', `${contractName}.sol`);

	if (!fs.existsSync(srcPath)) {
		return false;
	}

	ensureDir(destPath);

	const files = fs.readdirSync(srcPath);
	for (const file of files) {
		const content = fs.readFileSync(path.join(srcPath, file), 'utf8');
		fs.writeFileSync(path.join(destPath, file), content);
	}

	return true;
}

function main() {
	console.log('Building lazy-tokenswap-contracts package...\n');

	// Clean dist
	if (fs.existsSync(DIST_DIR)) {
		fs.rmSync(DIST_DIR, { recursive: true });
	}

	// Create directories
	ensureDir(path.join(DIST_DIR, 'abi'));
	ensureDir(path.join(DIST_DIR, 'types'));
	ensureDir(path.join(DIST_DIR, 'types', 'factories'));

	// Extract ABIs
	console.log('Extracting ABIs...');
	const abis = {};
	for (const contract of CONTRACTS) {
		const result = extractAbi(contract);
		if (result) {
			abis[contract] = result.abi;
			// Write individual ABI file
			fs.writeFileSync(
				path.join(DIST_DIR, 'abi', `${contract}.json`),
				JSON.stringify(result.abi, null, 2),
			);
			console.log(`  [OK] ${contract}`);
		}
	}

	// Write combined ABIs file
	fs.writeFileSync(
		path.join(DIST_DIR, 'abi', 'index.json'),
		JSON.stringify(abis, null, 2),
	);

	// Copy TypeScript types
	console.log('\nCopying TypeScript types...');
	for (const contract of CONTRACTS) {
		if (copyTypesDir(TYPES_DIR, path.join(DIST_DIR, 'types'), contract)) {
			copyFactoryDir(TYPES_DIR, path.join(DIST_DIR, 'types'), contract);
			console.log(`  [OK] ${contract}`);
		}
	}

	// Copy common.ts if exists
	const commonPath = path.join(TYPES_DIR, 'common.ts');
	if (fs.existsSync(commonPath)) {
		fs.copyFileSync(commonPath, path.join(DIST_DIR, 'types', 'common.ts'));
	}

	// Generate index files
	console.log('\nGenerating index files...');

	// Main index.js
	const indexJs = `/**
 * lazy-tokenswap-contracts
 * ABIs and TypeScript types for Lazy Token Swap contracts
 */

const UnifiedTokenSwap = require('./abi/UnifiedTokenSwap.json');
const NoFallbackTokenSwap = require('./abi/NoFallbackTokenSwap.json');
const FallbackTokenSwap = require('./abi/FallbackTokenSwap.json');
const BaseTokenSwap = require('./abi/BaseTokenSwap.json');

module.exports = {
  // ABIs
  UnifiedTokenSwapABI: UnifiedTokenSwap,
  NoFallbackTokenSwapABI: NoFallbackTokenSwap,
  FallbackTokenSwapABI: FallbackTokenSwap,
  BaseTokenSwapABI: BaseTokenSwap,

  // All ABIs object
  abis: {
    UnifiedTokenSwap,
    NoFallbackTokenSwap,
    FallbackTokenSwap,
    BaseTokenSwap,
  },
};
`;
	fs.writeFileSync(path.join(DIST_DIR, 'index.js'), indexJs);

	// ESM index
	const indexMjs = `/**
 * lazy-tokenswap-contracts (ESM)
 * ABIs and TypeScript types for Lazy Token Swap contracts
 */

import UnifiedTokenSwap from './abi/UnifiedTokenSwap.json' assert { type: 'json' };
import NoFallbackTokenSwap from './abi/NoFallbackTokenSwap.json' assert { type: 'json' };
import FallbackTokenSwap from './abi/FallbackTokenSwap.json' assert { type: 'json' };
import BaseTokenSwap from './abi/BaseTokenSwap.json' assert { type: 'json' };

export const UnifiedTokenSwapABI = UnifiedTokenSwap;
export const NoFallbackTokenSwapABI = NoFallbackTokenSwap;
export const FallbackTokenSwapABI = FallbackTokenSwap;
export const BaseTokenSwapABI = BaseTokenSwap;

export const abis = {
  UnifiedTokenSwap,
  NoFallbackTokenSwap,
  FallbackTokenSwap,
  BaseTokenSwap,
};

export default abis;
`;
	fs.writeFileSync(path.join(DIST_DIR, 'index.mjs'), indexMjs);

	// TypeScript declarations
	const indexDts = `/**
 * lazy-tokenswap-contracts
 * Type declarations
 */

import { InterfaceAbi } from 'ethers';

export declare const UnifiedTokenSwapABI: InterfaceAbi;
export declare const NoFallbackTokenSwapABI: InterfaceAbi;
export declare const FallbackTokenSwapABI: InterfaceAbi;
export declare const BaseTokenSwapABI: InterfaceAbi;

export declare const abis: {
  UnifiedTokenSwap: InterfaceAbi;
  NoFallbackTokenSwap: InterfaceAbi;
  FallbackTokenSwap: InterfaceAbi;
  BaseTokenSwap: InterfaceAbi;
};

export default abis;

// Re-export TypeScript contract types
export * from './types/UnifiedTokenSwap.sol';
export * from './types/NoFallbackTokenSwap.sol';
export * from './types/FallbackTokenSwap.sol';
export * from './types/BaseTokenSwap.sol';
`;
	fs.writeFileSync(path.join(DIST_DIR, 'index.d.ts'), indexDts);

	// Types index
	const typesIndex = `export * from './UnifiedTokenSwap.sol';
export * from './NoFallbackTokenSwap.sol';
export * from './FallbackTokenSwap.sol';
export * from './BaseTokenSwap.sol';
`;
	fs.writeFileSync(path.join(DIST_DIR, 'types', 'index.ts'), typesIndex);

	// Factories index
	const factoriesIndex = `export * from './UnifiedTokenSwap.sol';
export * from './NoFallbackTokenSwap.sol';
export * from './FallbackTokenSwap.sol';
export * from './BaseTokenSwap.sol';
`;
	fs.writeFileSync(path.join(DIST_DIR, 'types', 'factories', 'index.ts'), factoriesIndex);

	// Generate package.json
	const packageJson = {
		name: 'lazy-tokenswap-contracts',
		version: '2.0.0',
		description: 'ABIs and TypeScript types for Lazy Token Swap smart contracts on Hedera',
		main: 'index.js',
		module: 'index.mjs',
		types: 'index.d.ts',
		exports: {
			'.': {
				require: './index.js',
				import: './index.mjs',
				types: './index.d.ts',
			},
			'./abi/*': './abi/*',
			'./types/*': './types/*',
		},
		files: ['abi', 'types', 'index.js', 'index.mjs', 'index.d.ts'],
		keywords: ['hedera', 'hashgraph', 'nft', 'token-swap', 'smart-contracts', 'abi', 'lazy', 'typescript'],
		author: 'Lazy Superheroes',
		license: 'MIT',
		repository: {
			type: 'git',
			url: 'git+https://github.com/lazysuperheroes/hedera-SC-LAZY-tokenswap.git',
		},
		bugs: {
			url: 'https://github.com/lazysuperheroes/hedera-SC-LAZY-tokenswap/issues',
		},
		homepage: 'https://github.com/lazysuperheroes/hedera-SC-LAZY-tokenswap#readme',
		peerDependencies: {
			ethers: '^6.0.0',
		},
		peerDependenciesMeta: {
			ethers: {
				optional: true,
			},
		},
	};
	fs.writeFileSync(
		path.join(DIST_DIR, 'package.json'),
		JSON.stringify(packageJson, null, 2),
	);

	console.log('\nBuild complete! Output in dist/');
	console.log('\nTo publish:');
	console.log('  cd dist && npm publish');
}

main();
