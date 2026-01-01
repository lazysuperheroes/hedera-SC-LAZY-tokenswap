# Hedera Token Swap Contracts

Smart contracts for NFT token swapping on Hedera Hashgraph network. Supports multiple swap strategies including treasury destination, graveyard (permanent disposal), and LAZY token reward distributions.

## Contracts

### UnifiedTokenSwap (Recommended)
Universal NFT swap contract with:
- **Multi-token support**: Configure multiple input/output token combinations
- **3-legged HBAR royalty bypass**: Uses tinybar transfers to defeat NFT fallback fees on each leg
- **Optional graveyard integration**: Send old NFTs to Token Graveyard for permanent disposal
- **Multi-admin governance**: Multiple admins with protection against removing the last admin
- **Auto-association**: Automatically associates input tokens when adding swap configs
- **Admin recovery**: `unstakeNFTs` function allows admins to recover stuck NFTs (receiver needs HBAR allowance)

**User Requirements:**
- NFT allowance to contract (for old NFT transfer)
- HBAR allowance to contract (1 tinybar per swap, net cost = 0)

### NoFallbackTokenSwap (Legacy)
Simpler swap contract for LAZY ecosystem projects:
- Single output token collection
- LAZY token rewards per swap via LazyGasStation
- No royalty bypass (use for non-royalty NFTs only)

### FallbackTokenSwap (Legacy)
Enhanced swap for NFTs with fallback fees:
- LAZY tinybar-based royalty bypass
- Auto-refill from LazyGasStation
- Three-phase atomic transfers

## Quick Start

### Prerequisites
- Node.js 18+
- Hedera testnet/mainnet account

### Installation

```bash
npm install
```

### Configuration

Create `.env` file:

```env
ENVIRONMENT=TEST          # TEST, MAIN, PREVIEW, or LOCAL
ACCOUNT_ID=0.0.xxxxx      # Your Hedera account ID
PRIVATE_KEY=302e...       # ED25519 or ECDSA private key

# Optional for graveyard testing
TOKEN_GRAVEYARD_CONTRACT_ID=0.0.xxxxx
LAZY_TOKEN_ID=0.0.731861  # Mainnet LAZY token
```

### Build

```bash
npx hardhat compile
```

### Test

```bash
# NoFallbackTokenSwap tests
npm run test-nfb

# FallbackTokenSwap tests
npm run test-fb

# UnifiedTokenSwap tests
npm run test-uts
```

## Usage

See [DEPLOY.md](./DEPLOY.md) for deployment instructions.

See [docs/UX_IMPLEMENTATION_GUIDE.md](./docs/UX_IMPLEMENTATION_GUIDE.md) for frontend integration guide.

## Project Structure

```
contracts/
  UnifiedTokenSwap.sol       # Universal swap contract (recommended)
  NoFallbackTokenSwap.sol    # Legacy swap without royalty handling
  FallbackTokenSwap.sol      # Legacy swap with LAZY royalty bypass
  LazyGasStation.sol         # LAZY token distribution utility
  HederaTokenServiceLite.sol # Extended HTS precompile interface

scripts/
  unified/                   # UnifiedTokenSwap scripts
  interactions/              # NoFallbackTokenSwap scripts
  withFallback/              # FallbackTokenSwap scripts
  debug/                     # Debugging utilities

test/
  UnifiedTokenSwap.test.cjs
  NoFallbackTokenSwap.test.cjs
  FallbackTokenSwap.test.cjs

docs/
  UX_IMPLEMENTATION_GUIDE.md # Frontend integration guide
```

## Multi-Sig Support

All admin scripts support multi-signature workflows via `@lazysuperheroes/hedera-multisig`:

```bash
# Normal execution
node scripts/unified/adminManagement.cjs --pause

# Multi-sig workflow
node scripts/unified/adminManagement.cjs --pause --multisig --threshold=2

# See multi-sig help
node scripts/unified/adminManagement.cjs --multisig-help
```

## Gas Considerations

| Operation | Estimated Gas |
|-----------|--------------|
| Deploy UnifiedTokenSwap | ~5,000,000 |
| addOutputToken (with association) | ~1,400,000 |
| addSwapConfigs (no new associations) | ~500,000 |
| addSwapConfigs (with auto-association) | ~1,500,000 (+950K per token) |
| swapNFTs (treasury flow, 3-legged) | ~1,200,000 |
| swapNFTs (graveyard flow, 3-legged) | ~1,200,000 |
| stakeNFTs | ~600,000 |
| unstakeNFTs | ~600,000 |

## License

GPL-3.0

## Links

- [Lazy Superheroes](https://lazysuperheroes.com)
- [Hedera Documentation](https://docs.hedera.com)
- [Token Graveyard](https://www.npmjs.com/package/@lazysuperheroes/token-graveyard)
