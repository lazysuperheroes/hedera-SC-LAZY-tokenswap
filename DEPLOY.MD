# Deployment Guide

Step-by-step deployment instructions for all token swap contracts.

## Prerequisites

1. Hedera account with sufficient HBAR for deployment and operations
2. `.env` file configured (see README.md)
3. Dependencies installed: `npm install`
4. Contracts compiled: `npx hardhat compile`

---

## UnifiedTokenSwap Deployment (Recommended)

### Step 1: Deploy Contract

```bash
node scripts/unified/deployUnifiedTokenSwap.cjs
```

Options:
- `--graveyard=0.0.xxxxx` - Token Graveyard contract ID (optional)

Output: Contract ID saved to `UNIFIED_TOKEN_SWAP_CONTRACT_ID` in `.env`

### Step 2: Fund Contract with HBAR

The contract needs HBAR to pay tinybars during swaps (royalty defeat):
- Treasury flow: net -1 tinybar per swap (pays 2, receives 1)
- Graveyard flow: net 0 tinybars per swap (pays 1, receives 1)

Send 2-10 HBAR to the contract:

```bash
node scripts/unified/adminManagement.cjs --contract 0.0.CONTRACT_ID --fund-hbar 5
```

### Step 3: Add Output Token(s)

Associate output NFT tokens the contract will distribute:

```bash
node scripts/unified/setupSwapConfig.cjs --contract 0.0.CONTRACT_ID --add-token 0.0.OUTPUT_TOKEN_ID
```

**Gas note:** Uses ~1,400,000 gas per token association (auto-set by script).

### Step 4: Stake Output NFTs into Contract

Load the new NFTs into the contract so it can distribute them during swaps.
The script handles tinybar royalty defeat automatically.

```bash
node scripts/unified/stakeNFTs.cjs --contract 0.0.CONTRACT_ID --token 0.0.OUTPUT_TOKEN_ID --serials 1,2,3,4,5
```

**Note:** Max 8 NFTs per transaction (Hedera limit). The script auto-batches if you provide more.

### Step 5: Configure Swap Mappings

Create a JSON file `swaps.json`:

```json
[
  {
    "inputToken": "0.0.123456",
    "inputSerial": 1,
    "outputToken": "0.0.789012",
    "outputSerial": 1,
    "treasury": "0.0.111111",
    "useGraveyard": false
  },
  {
    "inputToken": "0.0.123456",
    "inputSerial": 2,
    "outputToken": "0.0.789012",
    "outputSerial": 2,
    "treasury": "0.0.111111",
    "useGraveyard": false
  },
  {
    "inputToken": "0.0.123456",
    "inputSerial": 3,
    "outputToken": "0.0.789012",
    "outputSerial": 3,
    "useGraveyard": true
  }
]
```

Load configurations:

```bash
node scripts/unified/setupSwapConfig.cjs --contract 0.0.CONTRACT_ID --batch-add swaps.json
```

**Gas note:** Uses ~1,500,000 gas (auto-set). Add ~950,000 extra per new input token being associated.

### Step 6: Verify Setup

```bash
# Check contract info (admins, tokens, HBAR balance, pause status)
node scripts/unified/adminManagement.cjs --contract 0.0.CONTRACT_ID --info

# Query a specific swap config
node scripts/unified/unifiedSwap.cjs --contract 0.0.CONTRACT_ID --query --token 0.0.123456 --serial 1
```

### Step 7: Unpause Contract

```bash
node scripts/unified/adminManagement.cjs --contract 0.0.CONTRACT_ID --unpause
```

### User Requirements for Swapping

Before users can swap, they need:

1. **Output token association** - Associate the new NFT token with their account
2. **NFT allowance to contract** - Grant the contract permission to transfer their old NFT (uses `approveTokenNftAllowanceAllSerials` to avoid Hedera's 100-allowance limit)
3. **HBAR allowance to contract** - Grant 1 tinybar allowance per swap (net cost = 0)

```javascript
// Example: Set up user for swapping (Hedera SDK)
// 1. Associate output token
await new TokenAssociateTransaction()
  .setAccountId(userAccountId)
  .setTokenIds([outputTokenId])
  .execute(client);

// 2. Grant NFT allowance (all serials - avoids 100-allowance limit)
await new AccountAllowanceApproveTransaction()
  .approveTokenNftAllowanceAllSerials(inputTokenId, userAccountId, contractAccountId)
  .execute(client);

// 3. Grant HBAR allowance (1 tinybar per swap)
await new AccountAllowanceApproveTransaction()
  .approveHbarAllowance(userAccountId, contractAccountId, Hbar.fromTinybars(100))
  .execute(client);
```

### Allowance Limit Note

Hedera imposes a ~100 allowance slot limit per account. The contract uses `setApprovalForAll` (once per token) for graveyard approvals instead of per-serial `approveNFT` to stay within this limit. Monitor usage with:

```bash
node scripts/unified/adminManagement.cjs --contract 0.0.CONTRACT_ID --info
```

The `--info` output shows the graveyard approval count and warns when approaching the limit.

---

## NoFallbackTokenSwap Deployment (Legacy)

For swaps without NFT royalties, with LAZY rewards.

### Step 1: Deploy Contract

```bash
node scripts/interactions/deployNoFallbackTokenSwap.cjs
```

### Step 2: Configure Token Addresses

```bash
node scripts/interactions/setupTokenSwapContract.cjs mapping.csv
```

CSV format:
```csv
oldToken,oldSerial,newSerial
0.0.123456,1,1
0.0.123456,2,2
```

### Step 3: Set LAZY Reward Amount

```bash
node scripts/interactions/setLazyClaimAmount.cjs 250
```

### Step 4: Unpause

```bash
node scripts/shared/set-pause.cjs --contract=0.0.xxxxx --unpause
```

---

## FallbackTokenSwap Deployment (Legacy)

For swaps with NFT royalties, using LAZY for royalty bypass.

### Step 1: Deploy LazyGasStation

```bash
node scripts/withFallback/deployLGS.cjs
```

### Step 2: Deploy FallbackTokenSwap

```bash
node scripts/withFallback/deployFallbackTokenSwap.cjs
```

### Step 3: Configure LGS Contract User

```bash
node scripts/withFallback/setLGSContractUser.cjs
```

### Step 4: Configure Swap Mappings

```bash
node scripts/withFallback/setupTokenSwapContract.cjs mapping.csv
```

### Step 5: Set LAZY Reward Amount

```bash
node scripts/withFallback/setLazyClaimAmount.cjs 250
```

### Step 6: Stake New NFTs

```bash
node scripts/withFallback/stakeNewTokens.cjs
```

### Step 7: Unpause

```bash
node scripts/shared/set-pause.cjs --contract=0.0.xxxxx --unpause
```

---

## Multi-Sig Deployment

For production deployments requiring multiple signatures:

```bash
# Any admin script with --multisig flag
node scripts/unified/adminManagement.cjs --pause --multisig --threshold=2

# Export transaction for offline signing
node scripts/unified/adminManagement.cjs --pause --multisig --export-only

# Apply collected signatures
node scripts/unified/adminManagement.cjs --pause --multisig --signatures=sig1.json,sig2.json
```

See `--multisig-help` on any script for detailed multi-sig usage.

---

## Post-Deployment Checklist

- [ ] Contract deployed and ID recorded
- [ ] Contract funded with HBAR (2-10 HBAR for tinybar operations)
- [ ] Output token(s) associated with contract (`--add-token`)
- [ ] Output NFTs staked into contract (`stakeNFTs.cjs`)
- [ ] Swap configurations loaded (`--batch-add`)
- [ ] Treasury has input token associated (for treasury flow)
- [ ] Graveyard integration configured (if using graveyard flow)
- [ ] Contract unpaused
- [ ] Test swap executed successfully
- [ ] Frontend updated with contract address

---

## Troubleshooting

### "AssociationFailed" Error
- Contract needs more gas for token association (~1,400,000)
- Token may already be associated (check with `--info`)

### "NFTTransferFailed" Error
- Check user has granted NFT allowance to contract
- Check user has HBAR allowance to contract (1 tinybar per swap for royalty defeat)
- Check treasury has input token associated (for treasury flow)
- Verify NFT serial exists and is owned by expected party
- Verify contract has sufficient HBAR balance

### "ConfigNotFound" Error
- Swap configuration not loaded for this input token/serial
- Config may have been consumed by a previous swap (one-time use)

### "GraveyardStakeFailed" Error
- Graveyard contract must be associated with input token
- UTS must be registered as contract user of graveyard (if required)
- Check graveyard is not paused
