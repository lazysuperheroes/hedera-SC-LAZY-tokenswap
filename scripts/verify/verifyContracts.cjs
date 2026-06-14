'use strict';

/**
 * Verify this repo's contracts on Sourcify (sourcify.dev V2) via
 * @lazysuperheroes/hedera-verify.
 *
 * This replaces `npx hedera-verify harness` for our Hardhat 3 layout: the
 * package's own CLI resolves build-info from Hardhat 2 `.dbg.json` files (which
 * HH3 doesn't emit) and keys Sourcify on `sourceName`, while HH3 remaps the
 * source path inside the Standard-JSON input. We resolve the HH3 build here
 * (utils/verifyHelpers.cjs) and hand it to the package's verifyContracts()
 * engine, which does all the actual Sourcify work. Verification is read-only —
 * no private key, no gas.
 *
 * Usage:
 *   node scripts/verify/verifyContracts.cjs                 # verify every registry contract with a deployed id in .env
 *   node scripts/verify/verifyContracts.cjs --only UnifiedTokenSwap
 *   node scripts/verify/verifyContracts.cjs UnifiedTokenSwap=0.0.123456   # ad-hoc target(s)
 *   node scripts/verify/verifyContracts.cjs list            # show registry + which .env ids are set
 *   node scripts/verify/verifyContracts.cjs list-artifacts  # every compiled contract
 *
 * Options:
 *   --env <env>           override ENVIRONMENT (test|main|preview|local)
 *   --only <CSV>          restrict registry to these contract names
 *   --creation-tx <hash>  creation tx hash (improves match grade; single target)
 *   --no-skip             re-submit even if already verified
 *   --api <url>           override Sourcify server URL
 *   --browser <url>       override Sourcify repo browser URL
 *   --artifacts <dir>     override artifacts root (default ./artifacts)
 *   --poll-attempts <n>   max status polls per contract (default 45)
 *   --poll-interval <ms>  delay between polls (default 4000)
 *   -h, --help            show this help
 *
 * Reads .env from the current directory.
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const {
	verifyContracts,
	buildRegistryTargets,
	parseAdHocTarget,
} = require('@lazysuperheroes/hedera-verify');
const { resolveHederaVerifyBuild, listHederaVerifyArtifacts } = require('../../utils/verifyHelpers.cjs');

/**
 * Load the verify registry. This is an ESM repo, so config lives in
 * `verify.config.cjs` (a `verify.config.js` would be parsed as ESM and break the
 * package's own require()-based loader). Falls back to a `verify.config.js` or
 * the package.json "hederaVerify" key if someone prefers those.
 */
function loadVerifyConfig(cwd = process.cwd()) {
	for (const file of ['verify.config.cjs', 'verify.config.js']) {
		const p = path.join(cwd, file);
		if (fs.existsSync(p)) return require(p);
	}
	const pkgPath = path.join(cwd, 'package.json');
	if (fs.existsSync(pkgPath)) {
		try {
			const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
			if (pkg.hederaVerify) return pkg.hederaVerify;
		} catch (_e) { /* ignore malformed package.json */ }
	}
	return null;
}

function parseArgs(argv) {
	const positional = [];
	const flags = {};
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === '--no-skip') flags.noSkip = true;
		else if (a === '-h' || a === '--help') flags.help = true;
		else if (a.startsWith('--')) flags[a.slice(2)] = argv[++i];
		else positional.push(a);
	}
	return { positional, flags };
}

function resolveEnv(flags, cfg) {
	const env = flags.env || (cfg && cfg.env) || process.env.ENVIRONMENT;
	if (!env) {
		console.error('ERROR: ENVIRONMENT not set in .env, verify.config.js, or --env (test|main|preview|local)');
		process.exit(1);
	}
	return env;
}

function sharedOpts(flags, cfg) {
	return {
		apiUrl: flags.api || (cfg && cfg.apiUrl),
		browserUrl: flags.browser || (cfg && cfg.browserUrl),
		skipIfVerified: !flags.noSkip,
		maxPollAttempts: flags['poll-attempts'] ? Number(flags['poll-attempts']) : undefined,
		pollIntervalMs: flags['poll-interval'] ? Number(flags['poll-interval']) : undefined,
	};
}

function pad(s, n) {
	s = String(s == null ? '' : s);
	return s.length >= n ? s : s + ' '.repeat(n - s.length);
}

function printMatrix(results, skipped = []) {
	const cols = { name: 24, addr: 44, status: 18, match: 12 };
	const line = '='.repeat(112);
	console.log('\n' + line);
	console.log('VERIFICATION MATRIX');
	console.log(line);
	console.log(pad('Contract', cols.name) + pad('Address', cols.addr) + pad('Status', cols.status) + pad('Match', cols.match) + 'Note');
	console.log('-'.repeat(112));
	for (const r of results) {
		const ok = r.status === 'verified' || r.status === 'already_verified';
		const note = ok ? (r.repoUrl || '') : (r.message || '');
		console.log(pad(r.contractName, cols.name) + pad(r.address, cols.addr) + pad(r.status, cols.status) + pad(r.match || '-', cols.match) + note);
	}
	for (const s of skipped) {
		console.log(pad(s.contractName, cols.name) + pad('-', cols.addr) + pad('skipped', cols.status) + pad('-', cols.match) + s.reason);
	}
	console.log(line);
	const counts = {};
	for (const r of results) counts[r.status] = (counts[r.status] || 0) + 1;
	const summary = Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(', ');
	console.log(`Summary: ${summary || 'nothing attempted'}${skipped.length ? `, ${skipped.length} skipped` : ''}\n`);
}

function showHelp() {
	console.log(`
Verify this repo's contracts on Sourcify (sourcify.dev V2) via @lazysuperheroes/hedera-verify.

Usage:
  node scripts/verify/verifyContracts.cjs                 verify every registry contract with a deployed id in .env
  node scripts/verify/verifyContracts.cjs --only UnifiedTokenSwap
  node scripts/verify/verifyContracts.cjs UnifiedTokenSwap=0.0.123456   ad-hoc target(s); Name=<0.0.x|0xaddr>
  node scripts/verify/verifyContracts.cjs list            show registry + which .env ids are set
  node scripts/verify/verifyContracts.cjs list-artifacts  every compiled contract

Options:
  --env <env>           override ENVIRONMENT (test|main|preview|local)
  --only <CSV>          restrict registry to these contract names
  --creation-tx <hash>  creation tx hash (improves match grade; single target)
  --no-skip             re-submit even if already verified
  --api <url>           override Sourcify server URL
  --browser <url>       override Sourcify repo browser URL
  --artifacts <dir>     override artifacts root (default ./artifacts)
  --poll-attempts <n>   max status polls per contract (default 45)
  --poll-interval <ms>  delay between polls (default 4000)
  -h, --help            show this help

Verification is read-only — no private key, no gas. Reads .env from the current directory.
`);
}

function runList(cfg) {
	if (!cfg || !Array.isArray(cfg.registry)) {
		console.log('No verify.config.js registry found.');
		process.exit(0);
	}
	console.log('\nConfigured registry (contract -> .env id var; ✓ = currently set):');
	for (const e of cfg.registry) {
		const hit = (e.envVars || []).find(v => process.env[v]);
		const mark = hit ? `✓ ${hit}=${process.env[hit]}` : `· (${(e.envVars || []).join(' / ') || 'no envVars'})`;
		console.log(`  ${pad(e.contractName, 26)} ${mark}${e.sourceName ? `   [${e.sourceName}]` : ''}`);
	}
	console.log('');
	process.exit(0);
}

function runListArtifacts(flags) {
	const arts = listHederaVerifyArtifacts(flags.artifacts);
	if (arts.length === 0) {
		console.log('No compiled artifacts found. Run "npx hardhat compile" first.');
		process.exit(0);
	}
	console.log(`\n${arts.length} compiled contract(s) (✦ = deployable):`);
	for (const a of arts) console.log(`  ${a.deployable ? '✦' : ' '} ${pad(a.contractName, 30)} ${a.sourceName}`);
	console.log('');
	process.exit(0);
}

async function main() {
	const { positional, flags } = parseArgs(process.argv.slice(2));

	if (flags.help) {
		showHelp();
		process.exit(0);
	}

	const cfg = loadVerifyConfig();
	const sub = positional[0];
	if (sub === 'list') return runList(cfg);
	if (sub === 'list-artifacts') return runListArtifacts(flags);

	const env = resolveEnv(flags, cfg);

	// Build the target list: registry entries that have a deployed id in .env,
	// plus any ad-hoc Name=<id|0xaddr> positionals.
	let targets = [];
	let skipped = [];
	if (cfg && Array.isArray(cfg.registry)) {
		({ targets, skipped } = buildRegistryTargets(cfg.registry, { only: flags.only }));
	} else if (flags.only) {
		console.error('WARN: --only given but no verify.config.js registry found; ignoring.');
	}
	for (const token of positional) targets.push(parseAdHocTarget(token));

	if (targets.length === 0) {
		console.log('Nothing to verify. Add deployed ids to .env, pass Name=id args, or check verify.config.js.');
		printMatrix([], skipped);
		process.exit(0);
	}

	// Resolve each target's Hardhat 3 build up front so a missing/uncompiled
	// artifact surfaces as a per-contract error rather than aborting the run.
	const ready = [];
	const buildErrors = [];
	for (const t of targets) {
		try {
			t.build = resolveHederaVerifyBuild({ contractName: t.contractName, sourceName: t.sourceName, artifactsRoot: flags.artifacts });
			if (flags['creation-tx'] && targets.length === 1) t.creationTransactionHash = flags['creation-tx'];
			ready.push(t);
		} catch (e) {
			buildErrors.push({
				contractName: t.contractName,
				address: t.address || t.contractId || '?',
				status: 'error',
				match: null,
				message: e.message,
				repoUrl: null,
			});
		}
	}

	console.log(`Verifying ${ready.length} contract(s) on '${env}' via Sourcify...`);
	const results = ready.length ? await verifyContracts(ready, { env, ...sharedOpts(flags, cfg) }) : [];

	printMatrix([...results, ...buildErrors], skipped);

	const bad = [...results, ...buildErrors].some(r => r.status === 'failed' || r.status === 'error');
	process.exit(bad ? 1 : 0);
}

main().catch((err) => {
	console.error('\n❌ verify crashed:', err.message || err);
	process.exit(1);
});
