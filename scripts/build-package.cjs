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
	'LazyGasStation',
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

function copySubDir(srcBase, destBase, subPath) {
	const srcPath = path.join(srcBase, subPath);
	const destPath = path.join(destBase, subPath);

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
		if (copySubDir(TYPES_DIR, path.join(DIST_DIR, 'types'), `${contract}.sol`)) {
			copySubDir(TYPES_DIR, path.join(DIST_DIR, 'types'), path.join('factories', `${contract}.sol`));
			console.log(`  [OK] ${contract}`);
		} else {
			console.error(`  [SKIP] ${contract} types - not found`);
		}
	}

	// Copy common.ts if exists
	const commonPath = path.join(TYPES_DIR, 'common.ts');
	if (fs.existsSync(commonPath)) {
		fs.copyFileSync(commonPath, path.join(DIST_DIR, 'types', 'common.ts'));
	}

	// Generate index files dynamically from CONTRACTS array
	console.log('\nGenerating index files...');

	// Filter to only contracts that were actually extracted
	const available = CONTRACTS.filter(c => abis[c]);

	// Main index.js (CJS)
	const cjsRequires = available.map(c => `const ${c} = require('./abi/${c}.json');`).join('\n');
	const cjsExports = available.map(c => `  ${c}ABI: ${c},`).join('\n');
	const cjsAbis = available.map(c => `    ${c},`).join('\n');
	const indexJs = `/**\n * lazy-tokenswap-contracts\n * ABIs and TypeScript types for Lazy Token Swap contracts\n */\n\n${cjsRequires}\n\nmodule.exports = {\n${cjsExports}\n\n  abis: {\n${cjsAbis}\n  },\n};\n`;
	fs.writeFileSync(path.join(DIST_DIR, 'index.js'), indexJs);

	// ESM index
	const esmImports = available.map(c => `import ${c} from './abi/${c}.json' with { type: 'json' };`).join('\n');
	const esmExports = available.map(c => `export const ${c}ABI = ${c};`).join('\n');
	const esmAbis = available.map(c => `  ${c},`).join('\n');
	const indexMjs = `/**\n * lazy-tokenswap-contracts (ESM)\n * ABIs and TypeScript types for Lazy Token Swap contracts\n */\n\n${esmImports}\n\n${esmExports}\n\nexport const abis = {\n${esmAbis}\n};\n\nexport default abis;\n`;
	fs.writeFileSync(path.join(DIST_DIR, 'index.mjs'), indexMjs);

	// TypeScript declarations
	const dtsDecls = available.map(c => `export declare const ${c}ABI: InterfaceAbi;`).join('\n');
	const dtsAbis = available.map(c => `  ${c}: InterfaceAbi;`).join('\n');
	const dtsReexports = available.map(c => `export * from './types/${c}.sol';`).join('\n');
	const indexDts = `/**\n * lazy-tokenswap-contracts\n * Type declarations\n */\n\nimport { InterfaceAbi } from 'ethers';\n\n${dtsDecls}\n\nexport declare const abis: {\n${dtsAbis}\n};\n\nexport default abis;\n\n// Re-export TypeScript contract types\n${dtsReexports}\n`;
	fs.writeFileSync(path.join(DIST_DIR, 'index.d.ts'), indexDts);

	// Types index
	const typesIndex = available.map(c => `export * from './${c}.sol';`).join('\n') + '\n';
	fs.writeFileSync(path.join(DIST_DIR, 'types', 'index.ts'), typesIndex);

	// Factories index
	const factoriesIndex = available.map(c => `export * from './${c}.sol';`).join('\n') + '\n';
	fs.writeFileSync(path.join(DIST_DIR, 'types', 'factories', 'index.ts'), factoriesIndex);

	// Generate package.json
	const packageJson = {
		name: '@lazysuperheroes/lazy-tokenswap-contracts',
		version: '2.1.1',
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
		license: 'GPL-3.0',
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
		publishConfig: {
			access: 'public',
		},
	};
	fs.writeFileSync(
		path.join(DIST_DIR, 'package.json'),
		JSON.stringify(packageJson, null, 2),
	);

	// Generate README
	const readmeContent = `# @lazysuperheroes/lazy-tokenswap-contracts

ABIs and TypeScript types for the Lazy Token Swap smart contracts on Hedera Hashgraph.

## Install

\`\`\`bash
npm install @lazysuperheroes/lazy-tokenswap-contracts
\`\`\`

## Quick Start

\`\`\`javascript
import { UnifiedTokenSwapABI } from '@lazysuperheroes/lazy-tokenswap-contracts';
import { ethers } from 'ethers';

// Create contract instance
const contract = new ethers.Contract(contractAddress, UnifiedTokenSwapABI, signer);

// Query swap configuration
const configs = await contract.getSwapConfigs([inputToken], [serial]);

// Execute swap (requires NFT + HBAR allowances)
const tx = await contract.swapNFTs([inputToken], [serial]);
\`\`\`

## Exports

| Export | Description |
|--------|-------------|
| \`UnifiedTokenSwapABI\` | Multi-admin, multi-token swap with HBAR royalty defeat (recommended) |
| \`NoFallbackTokenSwapABI\` | Legacy swap without royalty handling |
| \`FallbackTokenSwapABI\` | Legacy swap with LAZY-based royalty bypass |
| \`BaseTokenSwapABI\` | Abstract base for legacy contracts |
| \`LazyGasStationABI\` | LAZY token distribution utility (legacy) |
| \`abis\` | Object containing all ABIs |

## TypeScript

Full TypeChain-generated types are included:

\`\`\`typescript
import { UnifiedTokenSwap } from '@lazysuperheroes/lazy-tokenswap-contracts/types/UnifiedTokenSwap.sol';
\`\`\`

## User Requirements for Swapping

Before calling \`swapNFTs\`, users need:

1. **Output token association** - Associate the new NFT token with their account
2. **NFT allowance** - Grant the contract \`approveTokenNftAllowanceAllSerials\` (avoids Hedera's 100-allowance limit)
3. **HBAR allowance** - Grant 1 tinybar per swap to the contract (for royalty defeat, net cost = 0)

> **Note:** Hedera limits accounts to ~100 allowance slots. The contract uses \`setApprovalForAll\` for graveyard approvals (once per token, not per serial) to stay within this limit. Use \`getGraveyardApprovalCount()\` to monitor usage.

## Links

- [Source & Documentation](https://github.com/lazysuperheroes/hedera-SC-LAZY-tokenswap)
- [Deployment Guide](https://github.com/lazysuperheroes/hedera-SC-LAZY-tokenswap/blob/main/DEPLOY.md)

## License

GPL-3.0
`;
	fs.writeFileSync(path.join(DIST_DIR, 'README.md'), readmeContent);
	console.log('  [OK] README.md');

	console.log('\nBuild complete! Output in dist/');
	console.log('\nTo publish:');
	console.log('  cd dist && npm publish');
}

main();
