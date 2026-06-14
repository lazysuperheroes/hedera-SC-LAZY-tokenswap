'use strict';

/**
 * hedera-verify registry for this repo.
 *
 * Maps each production contract to the .env var(s) that may hold its deployed
 * Hedera contract ID (the first present var wins). Consumed by the repo verify
 * runner: `node scripts/verify/verifyContracts.cjs` (npm run verify).
 *
 * `sourceName` is only needed when the source file path differs from
 * `contracts/<ContractName>.sol`.
 *
 * Why .cjs (not .js): this is an ESM repo ("type": "module"), so a plain
 * `verify.config.js` using module.exports would be parsed as ESM and fail. The
 * runner loads this .cjs file directly. (The package's own `npx hedera-verify`
 * CLI can't read it or our Hardhat 3 artifacts anyway — see scripts/verify.)
 */

module.exports = {
	// env: 'main',                          // optional — overrides ENVIRONMENT
	// apiUrl: 'https://sourcify.dev/server',
	// browserUrl: 'https://repo.sourcify.dev',

	registry: [
		// --- Recommended contract ---
		{ contractName: 'UnifiedTokenSwap', envVars: ['UNIFIED_TOKEN_SWAP_CONTRACT_ID'] },

		// --- Legacy contracts ---
		{ contractName: 'NoFallbackTokenSwap', envVars: ['TOKEN_SWAP_CONTRACT_ID'] },
		{ contractName: 'FallbackTokenSwap', envVars: ['FALLBACK_TOKEN_SWAP_CONTRACT_ID'] },
		{ contractName: 'LazyGasStation', envVars: ['LAZY_GAS_STATION_CONTRACT_ID'] },
		{
			contractName: 'LAZYTokenCreator',
			envVars: ['LAZY_SCT_CONTRACT_ID'],
			sourceName: 'contracts/legacy/LAZYTokenCreator.sol',
		},
	],
};
