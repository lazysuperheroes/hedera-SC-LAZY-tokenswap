# Multi-Agent Review: Implementation Plan

**Created**: 2026-03-06
**Source**: 8-agent review (architect, security, cli-master, debt-hunter, refactorer, qa, code-critic, product)
**Branch**: review-plan-execution
**Baseline**: main HEAD

---

## Phase A: Fix Blockers (Before Testnet E2E Testing)

These must be done first -- they will cause failures during testnet testing.

### A1. Fix `unifiedSwap.cjs` -- Add HBAR Allowance Setup
**Agents**: Architect, CLI-Master, Product, QA | **Severity**: BLOCKER
**File**: `scripts/unified/unifiedSwap.cjs`

The swap script sets NFT allowances but never sets the HBAR allowance required for step 3 of
the treasury/graveyard flow. Users will get `NFTTransferFailed` on every swap attempt.

- [x] A1.1 Before executing swap, query user's HBAR allowance to the contract via mirror node
- [x] A1.2 If insufficient, auto-set HBAR allowance (e.g., 100 tinybars) using `setHbarAllowance`
- [x] A1.3 Extend existing `--skip-allowance` flag to also skip HBAR allowance setup
- [x] A1.4 Update help text to document the HBAR allowance requirement

### A2. Fix DEPLOY.md -- CSV vs JSON Format Mismatch
**Agents**: Code-Critic, Product, CLI-Master | **Severity**: BLOCKER
**File**: `DEPLOY.md`

DEPLOY.md shows CSV format for swap configs but `setupSwapConfig.cjs --batch-add` expects JSON.

- [x] A2.1 Update DEPLOY.md Step 5 to show correct JSON format matching what `--batch-add` expects
- [x] A2.2 Add the `--contract` flag to all commands in DEPLOY.md
- [x] A2.3 Fix all `.js` references to `.cjs` throughout DEPLOY.md

### A3. Fix `.js` to `.cjs` Extension References in All Script Output
**Agents**: CLI-Master, Product, Architect | **Severity**: BLOCKER
**Files**: `scripts/unified/deployUnifiedTokenSwap.cjs`, `setupSwapConfig.cjs`, `unifiedSwap.cjs`, `adminManagement.cjs`

Help text and "Next steps" output reference `.js` extensions. Users copying commands get MODULE_NOT_FOUND.

- [x] A3.1 Fix `deployUnifiedTokenSwap.cjs` help text and next-steps output
- [x] A3.2 Fix `setupSwapConfig.cjs` help text
- [x] A3.3 Fix `unifiedSwap.cjs` help text
- [x] A3.4 Fix `adminManagement.cjs` help text
- [x] A3.5 Fix all other `.js` references in script output across the project (22 files)

### A4. Fix `setupSwapConfig.cjs` Default Gas Limits
**Agents**: Architect | **Severity**: HIGH
**File**: `scripts/unified/setupSwapConfig.cjs`

Default gas (300K) is too low for `--add-token` (needs ~1.4M for HTS association) and
`--add-swap` with new input tokens (needs ~1.5M for auto-association).

- [x] A4.1 Increase default gas for `--add-token` action to 1,400,000
- [x] A4.2 Increase default gas for `--add-swap` / `--batch-add` to 1,500,000 when new tokens involved
- [x] A4.3 Document gas requirements in help text for each action

### A5. Fix DEPLOY.md Step 3 -- Wrong Script and Flag
**Source**: Gap analysis | **Severity**: BLOCKER
**File**: `DEPLOY.md`

Step 3 uses `adminManagement.cjs --add-output-token` but that action doesn't exist.
The correct command is `setupSwapConfig.cjs --contract <id> --add-token <token_id>`.

- [x] A5.1 Fix Step 3 command to use `setupSwapConfig.cjs --add-token`
- [x] A5.2 Add `--contract` flag to the command
- [x] A5.3 Fix gas note to mention using `--gas 1400000`

---

## Phase B: Security & Correctness

Contract-level fixes. Some require recompilation and redeployment.

### B1. Add ReentrancyGuard to Legacy Contracts
**Agents**: Security (HIGH), Refactorer, Code-Critic, Architect
**Files**: `contracts/BaseTokenSwap.sol`, `contracts/NoFallbackTokenSwap.sol`, `contracts/FallbackTokenSwap.sol`

- [x] B1.1 Add `ReentrancyGuard` import and inheritance to `BaseTokenSwap`
- [x] B1.2 Add `nonReentrant` modifier to `NoFallbackTokenSwap.swapNFTs()`
- [x] B1.3 Add `nonReentrant` modifier to `FallbackTokenSwap.swapNFTs()` and `stakeNFTs()`
- [x] B1.4 Compile and verify no errors

### B2. Add `outputToken != address(0)` Validation in `addSwapConfigs`
**Agents**: Security (MEDIUM)
**File**: `contracts/UnifiedTokenSwap.sol`

- [x] B2.1 Add validation in `addSwapConfigs` loop: `if (_configs[i].outputToken == address(0)) revert BadInput();`
- [x] B2.2 Compile and verify

### B3. Fix License Inconsistency
**Agents**: Code-Critic
**Files**: `package.json`, `scripts/build-package.cjs`

- [x] B3.1 Update root `package.json` license to `GPL-3.0`
- [x] B3.2 Update `build-package.cjs` dist package.json license to `GPL-3.0`

### B5. Fix ESM `assert` to `with` in Build Package Template
**Agents**: Architect, Code-Critic, Refactorer, CLI-Master, Product
**File**: `scripts/build-package.cjs`

- [x] B5.1 Change `assert { type: 'json' }` to `with { type: 'json' }` in ESM template

### B6. Add `updateSwapTokenTreasury()` to BaseTokenSwap
**Agents**: Code-Critic (MEDIUM)
**File**: `contracts/BaseTokenSwap.sol`

- [x] B6.1 Add `updateSwapTokenTreasury(address)` with zero-address check, `onlyOwner`
- [x] B6.2 Compile and verify

### B7. Add Constructor Validation to BaseTokenSwap
**Agents**: Code-Critic
**File**: `contracts/BaseTokenSwap.sol`

- [x] B7.1 Add `require` checks for all four constructor parameters being non-zero

### B8. Fix LazyGasStation Event Emission Order
**Agents**: Code-Critic
**File**: `contracts/LazyGasStation.sol`

- [x] B8.1 Emit events only when the set operation returns `true`

---

## Phase C: Scripts & CLI UX

### C1. Create `scripts/unified/stakeNFTs.cjs`
**Agents**: CLI-Master, Product | **Severity**: HIGH
**File**: NEW

- [x] C1.1 Create script accepting `--contract`, `--token`, `--serials`, `--gas`
- [x] C1.2 Auto-set NFT allowance from operator to contract
- [x] C1.3 Call contract `stakeNFTs(token, serials)`
- [x] C1.4 Auto-batch if >8 serials provided (MAX_NFTS_PER_TX = 8)
- [x] C1.5 Add `--help`, `--json`, `--yes` support
- [x] C1.6 Print summary of staked NFTs

### C2. Create `scripts/unified/unstakeNFTs.cjs`
**Agents**: CLI-Master, Product | **Severity**: HIGH
**File**: NEW

- [x] C2.1 Create script accepting `--contract`, `--token`, `--serials`, `--receiver`, `--gas`
- [x] C2.2 Warn that receiver must have HBAR allowance to contract
- [x] C2.3 Add `--help`, `--json`, `--yes` support

### C3. Add HBAR Balance and Funding to `adminManagement.cjs`
**Agents**: CLI-Master, Product, Architect
**File**: `scripts/unified/adminManagement.cjs`

- [x] C3.1 Add HBAR balance query to `--info` output (via mirror node)
- [x] C3.2 Add `--fund-hbar <amount>` action that sends HBAR to the contract
- [x] C3.3 Update help text

### C4. Update `verify-setup.cjs` for UnifiedTokenSwap
**Agents**: CLI-Master, QA, Product, Architect
**File**: `scripts/verify-setup.cjs`

- [x] C4.1 Add `UnifiedTokenSwap` to `REQUIRED_ARTIFACTS` array
- [x] C4.2 Add `UNIFIED_TOKEN_SWAP_CONTRACT_ID` and `TOKEN_GRAVEYARD_CONTRACT_ID` to `OPTIONAL_ENV_VARS`

### C5. Update `.env.example`
**Agents**: QA, CLI-Master, Product, Debt-Hunter
**File**: `.env.example`

- [x] C5.1 Add `UNIFIED_TOKEN_SWAP_CONTRACT_ID=`
- [x] C5.2 Add `TOKEN_GRAVEYARD_CONTRACT_ID=`
- [x] C5.3 Add comments indicating which variables are for which contract type
- [x] C5.4 Reorder so UnifiedTokenSwap (recommended) vars come first

### C6. Fix Broken npm Scripts in package.json
**Agents**: Debt-Hunter
**File**: `package.json`

- [x] C6.1 Fix `deploy` script to `deploy:unified` pointing to `scripts/unified/deployUnifiedTokenSwap.cjs`
- [x] C6.2 Fix `logs` script path to `scripts/debug/getContractLogs.cjs`

### C8. Add Pre-flight Admin Check to Admin Scripts
**Agents**: CLI-Master
**Files**: `adminManagement.cjs`, `setupSwapConfig.cjs`

- [x] C8.1 In admin scripts, query `isAdmin(operatorAddress)` via mirror node before executing
- [x] C8.2 Abort early with clear message if not admin, listing current admins

### C9. Add Error Decoding to Script Transaction Failures
**Agents**: CLI-Master, Architect, Product
**Files**: `utils/solidityHelpers.cjs`

- [x] C9.1 Error decoder already exists in `solidityHelpers.cjs` (`parseError` function)
- [x] C9.2 Already includes custom error decoding with selector matching
- [x] C9.3 Already integrated into `contractExecuteFunction`

### C10. Add Env Var Validation to Legacy Deploy Scripts
**Agents**: CLI-Master
**Files**: `scripts/interactions/deployNoFallbackTokenSwap.cjs`, `scripts/withFallback/deployFallbackTokenSwap.cjs`

- [x] C10.1 Add env var validation before `TokenId.fromString()` / `AccountId.fromString()` calls
- [x] C10.2 Print clear error messages identifying which vars are missing

### C11. Fix `initializeClient()` Noise in JSON/Read-Only Scripts
**Agents**: CLI-Master
**File**: `utils/clientFactory.cjs`

- [x] C11.1 Add `{ quiet: true }` option to suppress stdout
- [x] C11.2 Backwards-compatible, existing callers unaffected

---

## Phase D: NPM Package & Documentation

### D1. Generate README.md in dist/ During Build
**Agents**: Product, CLI-Master, Code-Critic | **Severity**: HIGH
**File**: `scripts/build-package.cjs`

- [x] D1.1 Generate `dist/README.md` with overview, install, quick-start, exports table, links

### D2. Add `LazyGasStation` to NPM Package CONTRACTS
**Agents**: Code-Critic, CLI-Master
**File**: `scripts/build-package.cjs`

- [x] D2.1 Add `'LazyGasStation'` to the `CONTRACTS` array in build-package.cjs
- [x] D2.2 Index files now generated dynamically from CONTRACTS array

### D3. Fix DEPLOY.md Treasury Allowance Documentation
**Agents**: Product (P1-2)
**File**: `DEPLOY.md`

- [x] D3.1 Removed misleading "Treasury HBAR allowance" checklist item
- [x] D3.2 Added explicit "Fund Contract with HBAR" step with amounts and CLI command
- [x] D3.3 Added treasury association requirement in troubleshooting

### D4. Document Effective Batch Size Limits
**Agents**: Architect, Code-Critic
**Files**: `DEPLOY.md`

- [x] D4.1 Added batch limit note in DEPLOY.md Step 4 (max 8 NFTs per tx, auto-batched)

### D5. Fix DEPLOY.md Step 4 -- Reference stakeNFTs Script
**Source**: Gap analysis | **Severity**: HIGH
**File**: `DEPLOY.md`

- [x] D5.1 Replaced Step 4 with command using `scripts/unified/stakeNFTs.cjs`
- [x] D5.2 Documented that stakeNFTs handles royalty defeat automatically

### D6. Fix DEPLOY.md Step 5 -- Missing `--batch-add` Flag
**Source**: Gap analysis | **Severity**: HIGH
**File**: `DEPLOY.md`

- [x] D6.1 Fixed command to include `--batch-add` flag

### D7. Fix DEPLOY.md Troubleshooting Section
**Source**: Gap analysis | **Severity**: MEDIUM
**File**: `DEPLOY.md`

- [x] D7.1 Fixed "NFTTransferFailed" troubleshooting: removed wrong treasury HBAR allowance advice
- [x] D7.2 Added: "check user has HBAR allowance to contract for tinybar royalty defeat"
- [x] D7.3 Added: "check treasury has input token associated" as actual treasury requirement

### D8. Update Deploy Script Next-Steps Output
**Source**: Gap analysis | **Severity**: MEDIUM
**File**: `scripts/unified/deployUnifiedTokenSwap.cjs`

- [x] D8.1 Added stakeNFTs.cjs to next-steps output
- [x] D8.2 Added fund-hbar to next-steps output (now shows 5 deployment steps)

### D9. Fix multiSig Help Text Wrong Project Paths
**Agents**: CLI-Master, Debt-Hunter
**File**: `utils/multiSigIntegration.cjs`

- [x] D9.1 Updated path references from LazyLotto to this project's scripts

---

## Phase E: Code Quality & Cleanup

### E1. Remove Dead Code and Unused Exports
**Agents**: Debt-Hunter, Code-Critic
**Files**: Various

- [x] E1.1 Deleted `contracts/interfaces/ILazyDelegateRegistry.sol` (never imported)
- [x] E1.2 Deleted `scripts/extractABI.cjs` (duplicate of `scripts/debug/extractABI.cjs`)
- [x] E1.3 Deleted `utils/scriptHelpers.cjs` (148 lines, never imported by any file)
- [x] E1.4 Removed unused exports: `useSetter`, `linkBytecode` from `solidityHelpers.cjs`
- [x] E1.5 Removed unused export: `hex_to_ascii` from `nodeHelpers.cjs`
- [x] E1.6 Removed `getBaseURL` re-export from `solidityHelpers.cjs`
- [x] E1.7 Removed 10 commented-out `console.log` lines across utils/

### E3. Consolidate Duplicate `sleep()` Function
**Agents**: Refactorer, Debt-Hunter
**File**: `utils/solidityHelpers.cjs`

- [x] E3.1 Removed internal `sleep` from `solidityHelpers.cjs`, imported from `nodeHelpers.cjs`

### E4. UnifiedTokenSwap Solidity DRY Improvements
**Agents**: Refactorer
**File**: `contracts/UnifiedTokenSwap.sol`

- [x] E4.1 Extracted `_pullNftFromUser()` helper (shared by treasury + graveyard flows)
- [x] E4.2 Extracted `_sendNftToUser()` helper (shared by treasury + graveyard flows)
- [x] E4.3 Extracted `_associateIfNeeded()` helper (shared by `addOutputToken` + `_ensureInputTokenAssociated`)
- [x] E4.4 Refactored `stakeNFTs`/`unstakeNFTs` to use `_buildTinybarTransfer` helper
- [x] E4.5 Compiled successfully (17 files, solc 0.8.24)

### E6. Remove Tracked Data Files
**Agents**: Debt-Hunter
**Files**: `old-new-map_mainnet.csv`, `old-new-map_testnet.csv`

- [x] E6.1 Already untracked via `.gitignore` pattern `old*.csv`

### E7. Build Package DRY Improvements
**Agents**: Refactorer
**File**: `scripts/build-package.cjs`

- [x] E7.1 Generate index files dynamically from CONTRACTS array instead of hardcoded templates
- [x] E7.2 Merged `copyTypesDir`/`copyFactoryDir` into single `copySubDir` function

---

## Phase F: Testing Improvements

### F4. Remove Private Key Logging from Tests
**Agents**: Security (LOW)
**File**: `test/UnifiedTokenSwap.test.cjs`

- [x] F4.1 Removed private key logging from Alice/Bob account creation

### F1-F3. Additional Tests (Deferred)

These test additions require live testnet access and are deferred to end-to-end testing phase:

- [ ] F1.1 Add test: batch 2-3 treasury swaps in single call
- [ ] F1.2 Add test: mixed treasury + graveyard swaps in single call
- [ ] F2.1-F2.5 Negative tests (HBAR allowance, double swap, unauthorized unstake, etc.)
- [ ] F3.1-F3.2 NPM package build smoke test

---

## Dropped Items (Over-Scoped)

The following were considered but dropped as low-ROI:

- **C7** (Add `--yes` to 7 legacy scripts) -- Legacy contracts unlikely to see new deployments
- **E2** (Consolidate legacy script pairs) -- Refactoring deprecated scripts, low benefit
- **E5** (Storage layout optimization) -- Minimal gas savings (~200 gas/read), not worth the risk

## Execution Summary

| Phase | Items | Completed | Status |
|-------|-------|-----------|--------|
| A (Blockers) | 5 | 5 | DONE |
| B (Security) | 7 | 7 | DONE |
| C (Scripts) | 10 | 10 | DONE |
| D (Docs/Package) | 9 | 9 | DONE |
| E (Cleanup) | 5 | 5 | DONE |
| F (Tests) | 2 of 4 | 1 done, 3 deferred | PARTIAL |

**NOTE**: Phase B and E4 changed contract bytecode and require redeployment to testnet.

## Success Criteria

- [x] All contracts compile without warnings (17 files, solc 0.8.24)
- [x] `npm run build:package` produces complete, correct dist/ (5 ABIs, types, README)
- [x] DEPLOY.md accurately describes the deployment workflow
- [x] No license inconsistencies (all GPL-3.0)
- [x] No `.js` extension references in script output (22 files fixed)
- [ ] All unified scripts work end-to-end for testnet deployment + swap (requires testnet)
- [ ] `npm run test-uts` passes (requires testnet, contract bytecode changed)
- [ ] `npm run test-nfb` passes (requires testnet)
- [ ] `npm run test-fb` passes (requires testnet)

---
*Generated from 8-agent review on 2026-03-06*
*Implementation completed on 2026-03-06 on branch `review-plan-execution`*
