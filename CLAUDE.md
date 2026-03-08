# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Hedera Hashgraph NFT token swap smart contracts for the Lazy Superheroes ecosystem. Enables exchanging legacy NFTs for new collection NFTs with optional graveyard disposal and LAZY token rewards.

## Build & Test Commands

```bash
npm install                          # Install dependencies
npx hardhat compile                  # Compile Solidity contracts
npm run test-uts                     # Test UnifiedTokenSwap (recommended contract)
npm run test-nfb                     # Test NoFallbackTokenSwap (legacy)
npm run test-fb                      # Test FallbackTokenSwap (legacy)
npx hardhat test                     # Run all tests
npx solhint -f table contracts/**/*.sol  # Lint Solidity
npm run build:package                # Build NPM package (dist/)
```

Tests run against a **live Hedera network** (testnet by default). They require a configured `.env` with `ACCOUNT_ID`, `PRIVATE_KEY`, and `ENVIRONMENT`. Tests create accounts, mint NFTs, deploy contracts, and execute swaps on-chain. Expect slow runs (~100s+ timeout per test).

## Architecture

### Contract Hierarchy

There are two independent contract lineages:

**Legacy contracts** (single output token, LAZY rewards via LazyGasStation):
- `BaseTokenSwap` (abstract) - shared state, admin functions, swap config via `EnumerableMap.Bytes32ToUintMap`, `Ownable` access control
  - `NoFallbackTokenSwap` - direct NFT swap, no royalty handling
  - `FallbackTokenSwap` - 3-phase atomic transfer with LAZY tinybar for royalty bypass

**Recommended contract** (independent lineage, does NOT extend BaseTokenSwap):
- `UnifiedTokenSwap` - multi-admin via `EnumerableSet.AddressSet`, multi-token input/output, HBAR tinybar royalty defeat, optional Token Graveyard integration. Uses `HederaTokenServiceLite` (not `HederaTokenService`).

### HTS Precompile Wrappers

Two different HTS precompile abstractions exist:
- `HederaTokenService` (from Hedera SDK) - used by legacy contracts, calls `IHederaTokenService` with `int256` response codes
- `HederaTokenServiceLite` - custom minimal wrapper used by `UnifiedTokenSwap`, calls `IHederaTokenServiceLite` with `int32`/`int64` response codes, includes `cryptoTransfer(TransferList, TokenTransferList[])` for HBAR+NFT atomic transfers and `setApprovalForAll` for bulk NFT approval

Both target the HTS precompile at `address(0x167)`.

### Royalty Defeat Pattern (Tinybar Trick)

NFTs with fallback royalty fees require an accompanying fungible transfer. The contracts include 1-tinybar HBAR transfers alongside NFT moves to satisfy this requirement at near-zero cost:
- **Treasury flow** (3 legs): contract->user 1 tinybar + pull NFT, contract->treasury 1 tinybar + send NFT, user->contract 1 tinybar (via allowance) + send new NFT
- **Graveyard flow**: similar but old NFT goes to Token Graveyard via `stakeNFTsToTheGrave`

### Allowance Limit Handling

Hedera imposes a ~100 allowance slot limit per account (including smart contracts). To avoid exhausting this:
- **Graveyard approvals**: Contract uses `setApprovalForAll` (once per input token) instead of per-serial `approveNFT`. Tracked via `graveyardApprovals` mapping and `graveyardApprovalCount` counter. `getGraveyardApprovalCount()` exposes current usage.
- **User NFT allowances**: Scripts use `approveTokenNftAllowanceAllSerials` instead of per-serial allowances.
- **Staking allowances**: `stakeNFTs.cjs` uses `approveTokenNftAllowanceAllSerials` for the same reason.

### Swap Config Storage

- Legacy: `keccak256(abi.encodePacked(oldToken, oldSerial))` -> `uint256 newSerial` in `EnumerableMap`
- Unified: `keccak256(abi.encodePacked(inputToken, inputSerial))` -> `SwapConfig` struct in mapping. Configs are one-time use (deleted after swap).

### Key Differences: UnifiedTokenSwap vs Legacy

| Feature | UnifiedTokenSwap | Legacy (No/Fallback) |
|---|---|---|
| Access control | Multi-admin (`EnumerableSet`) | `Ownable` (single owner) |
| Token support | Multi input/output tokens | Single output token |
| Royalty defeat | HBAR tinybar | LAZY tinybar (Fallback) or none |
| Graveyard | Optional per-config | Not supported |
| LAZY rewards | Not supported | Via LazyGasStation |
| Graveyard approval | `setApprovalForAll` (per-token) | N/A |
| Auto-association | Input tokens on config add | Manual |

### Gas Estimation

All scripts use `estimateGas()` from `utils/gasHelpers.cjs` which queries the mirror node, applies a 1.5x buffer (under 600K) or 1.2x buffer (over 600K), and caps at 14.5M. Fallback values are used when estimation fails (e.g., state-changing HTS operations can't be simulated read-only). The `--gas` flag on any script overrides the estimate.

## Project Conventions

- **ESM project** (`"type": "module"` in package.json) but all scripts and tests use `.cjs` extension (CommonJS)
- Solidity `0.8.24` with optimizer enabled (200 runs)
- Hardhat 3 with `hardhat.config.js` (ESM)
- Scripts use `@hashgraph/sdk` for Hedera native operations and `ethers` v6 for ABI encoding
- Admin scripts support multi-sig via `@lazysuperheroes/hedera-multisig` (`--multisig` flag)
- Tests use Mocha/Chai with `@hashgraph/sdk` client, NOT Hardhat's local EVM (contracts use HTS precompile)
- Utility modules in `utils/` provide shared helpers: `hederaHelpers.cjs` (account/token ops), `solidityHelpers.cjs` (deploy/execute), `hederaMirrorHelpers.cjs` (mirror node queries)

## Environment Configuration

`.env` requires at minimum:
```
ENVIRONMENT=TEST          # TEST, MAIN, PREVIEW, or LOCAL
ACCOUNT_ID=0.0.xxxxx
PRIVATE_KEY=302e...       # ED25519 or ECDSA
```

Optional for graveyard testing: `TOKEN_GRAVEYARD_CONTRACT_ID=0.0.xxxxx`

## NPM Package Build

`npm run build:package` extracts ABIs and TypeChain types for `UnifiedTokenSwap`, `NoFallbackTokenSwap`, `FallbackTokenSwap`, and `BaseTokenSwap` into `dist/`. Published as `@lazysuperheroes/lazy-tokenswap-contracts`.
