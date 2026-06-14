'use strict';

/**
 * Hardhat 3 build-info adapter for @lazysuperheroes/hedera-verify.
 *
 * The published package resolves a contract's Standard-JSON input via Hardhat 2's
 * `<Contract>.dbg.json` pointer and builds the Sourcify contract identifier as
 * `<sourceName>:<ContractName>`. Hardhat 3 changed both of these:
 *   - it no longer emits `.dbg.json` files; each artifact carries a `buildInfoId`
 *     that maps to `artifacts/build-info/<buildInfoId>.json`, and
 *   - it remaps source paths inside the Standard-JSON input (e.g.
 *     `contracts/Foo.sol` becomes `project/contracts/Foo.sol`), exposed on the
 *     artifact as `inputSourceName`. Sourcify keys the contract on the path that
 *     actually appears in `stdJsonInput.sources`, so the identifier MUST use
 *     `inputSourceName`, not `sourceName`.
 *
 * So instead of letting the package resolve the build, we pre-resolve it here and
 * hand `verifyContract`/`verifyContracts` a ready `build` object — the package
 * supports exactly this via its `build` option, and skips its own resolver. All
 * actual verification (Sourcify V2 submit/poll, mirror-node address resolution)
 * still happens inside the package.
 */

const fs = require('fs');
const path = require('path');

/**
 * Default artifacts root: the repo's ./artifacts. Override via the
 * `artifactsRoot` option or the HEDERA_VERIFY_ARTIFACTS env var.
 * @returns {string}
 */
function defaultArtifactsRoot() {
	return process.env.HEDERA_VERIFY_ARTIFACTS || path.join(process.cwd(), 'artifacts');
}

/** True for a compiled-contract artifact JSON (not a .dbg.json or .d.ts). */
function isArtifactJson(name) {
	return name.endsWith('.json') && !name.endsWith('.dbg.json') && !name.endsWith('.d.ts');
}

/**
 * Recursively find a contract's artifact JSON under <root>/contracts. Hardhat
 * names the folder after the SOURCE file and the json after the CONTRACT, so
 * `<ContractName>.json` is unique per (file, contract).
 * @returns {string[]} absolute paths of every match
 */
function findArtifactFiles(root, contractName) {
	const target = `${contractName}.json`;
	const matches = [];
	const walk = (dir) => {
		let entries;
		try {
			entries = fs.readdirSync(dir, { withFileTypes: true });
		} catch (_e) {
			return;
		}
		for (const entry of entries) {
			const full = path.join(dir, entry.name);
			if (entry.isDirectory()) walk(full);
			else if (entry.name === target) matches.push(full);
		}
	};
	// Only the project's own sources need verifying — skip node_modules deps
	// that Hardhat copies into artifacts/npm/ etc.
	walk(path.join(root, 'contracts'));
	return matches;
}

/**
 * List every compiled project contract as { contractName, sourceName,
 * deployable }. Handy for populating verify.config.js — mirrors
 * `npx hedera-verify list-artifacts`, which doesn't work on a Hardhat 3 layout.
 * @param {string} [artifactsRoot]
 * @returns {{contractName: string, sourceName: string, deployable: boolean}[]}
 */
function listHederaVerifyArtifacts(artifactsRoot = defaultArtifactsRoot()) {
	const out = [];
	const walk = (dir) => {
		let entries;
		try {
			entries = fs.readdirSync(dir, { withFileTypes: true });
		} catch (_e) {
			return;
		}
		for (const entry of entries) {
			const full = path.join(dir, entry.name);
			if (entry.isDirectory()) {
				walk(full);
			} else if (isArtifactJson(entry.name)) {
				let art;
				try {
					art = JSON.parse(fs.readFileSync(full, 'utf8'));
				} catch (_e) {
					continue;
				}
				if (!art || !art.contractName || !art.buildInfoId) continue;
				out.push({
					contractName: art.contractName,
					sourceName: art.sourceName,
					deployable: Boolean(art.bytecode && art.bytecode !== '0x'),
				});
			}
		}
	};
	walk(path.join(artifactsRoot, 'contracts'));
	return out;
}

/**
 * Resolve a contract's Sourcify `build` payload from Hardhat 3 artifacts.
 *
 * @param {object} opts
 * @param {string} opts.contractName  e.g. "UnifiedTokenSwap"
 * @param {string} [opts.sourceName]  user source path (e.g.
 *        "contracts/legacy/LAZYTokenCreator.sol") — pass to disambiguate when the
 *        same contract name compiles from two files.
 * @param {string} [opts.artifactsRoot]
 * @returns {{ stdJsonInput: object, compilerVersion: string,
 *             contractIdentifier: string, sourceName: string,
 *             inputSourceName: string }}
 */
function resolveHederaVerifyBuild({ contractName, sourceName, artifactsRoot = defaultArtifactsRoot() } = {}) {
	if (!contractName) throw new Error('resolveHederaVerifyBuild: contractName is required');

	let artifactPath;
	if (sourceName) {
		artifactPath = path.join(artifactsRoot, sourceName, `${contractName}.json`);
		if (!fs.existsSync(artifactPath)) {
			throw new Error(`No artifact for ${sourceName}:${contractName} at ${artifactPath} — compile first (npx hardhat compile)`);
		}
	} else {
		const found = findArtifactFiles(artifactsRoot, contractName);
		if (found.length === 0) {
			throw new Error(`No compiled artifact for contract '${contractName}' under ${artifactsRoot}/contracts — compile first, or pass sourceName`);
		}
		if (found.length > 1) {
			const rels = found.map(f => path.relative(artifactsRoot, f));
			throw new Error(`Contract name '${contractName}' is ambiguous (${found.length} matches): ${rels.join(', ')} — pass sourceName to disambiguate`);
		}
		artifactPath = found[0];
	}

	const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
	const resolvedSourceName = artifact.sourceName;
	// `inputSourceName` is the path key used inside stdJsonInput.sources (HH3
	// remaps it, e.g. "project/contracts/Foo.sol"). Older artifacts without it
	// fall back to sourceName.
	const inputSourceName = artifact.inputSourceName || resolvedSourceName;
	const buildInfoId = artifact.buildInfoId;
	if (!buildInfoId) {
		throw new Error(`Artifact ${artifactPath} has no buildInfoId — recompile with Hardhat 3 (npx hardhat compile)`);
	}

	const buildInfoPath = path.join(artifactsRoot, 'build-info', `${buildInfoId}.json`);
	if (!fs.existsSync(buildInfoPath)) {
		throw new Error(`build-info '${buildInfoId}' not found at ${buildInfoPath} — recompile to regenerate`);
	}

	const buildInfo = JSON.parse(fs.readFileSync(buildInfoPath, 'utf8'));
	if (!buildInfo.input || !buildInfo.solcLongVersion) {
		throw new Error(`build-info at ${buildInfoPath} is missing input/solcLongVersion`);
	}

	return {
		stdJsonInput: buildInfo.input,
		compilerVersion: buildInfo.solcLongVersion,
		contractIdentifier: `${inputSourceName}:${contractName}`,
		sourceName: resolvedSourceName,
		inputSourceName,
	};
}

module.exports = {
	defaultArtifactsRoot,
	findArtifactFiles,
	listHederaVerifyArtifacts,
	resolveHederaVerifyBuild,
};
