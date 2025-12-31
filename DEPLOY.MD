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

Send 2-10 HBAR to the contract for tinybar operations (royalty defeat):

```bash
# Via HashScan or wallet, send HBAR to the contract's EVM address
```

### Step 3: Add Output Token(s)

Associate output NFT tokens the contract will distribute:

```bash
node scripts/unified/adminManagement.cjs --add-output-token=0.0.xxxxx
```

**Gas note:** ~1,400,000 gas per token association

### Step 4: Transfer Output NFTs to Contract

Send the new NFT serials to the contract address so it can distribute them:

```bash
# Via HashScan or your minting script
```

### Step 5: Configure Swap Mappings

Create a CSV file `swap_config.csv`:

```csv
inputToken,inputSerial,outputToken,treasury,useGraveyard,outputSerial
0.0.123456,1,0.0.789012,0.0.111111,false,1
0.0.123456,2,0.0.789012,0.0.111111,false,2
0.0.123456,3,0.0.789012,,true,3
```

Load configurations:

```bash
node scripts/unified/setupSwapConfig.cjs swap_config.csv
```

**Gas note:** Add ~950,000 extra gas per new input token with `useGraveyard=true` (auto-associates)

### Step 6: Verify Contract HBAR Balance

The contract needs HBAR to pay tinybars during swaps:
- Treasury flow: Contract pays 2 tinybars (step 1 + step 2), receives 1 (step 3) = net -1 per swap
- Graveyard flow: Contract pays 1 tinybar, receives 1 = net 0 per swap

```bash
# Ensure contract has sufficient HBAR (sent during step 2)
# For treasury flow, contract consumes 1 tinybar per swap
```

### Step 7: Unpause Contract

```bash
node scripts/unified/adminManagement.cjs --unpause
```

### Verification

```bash
# Check contract info
node scripts/unified/adminManagement.cjs --info

# Query swap config
node scripts/unified/unifiedSwap.cjs --query --token=0.0.123456 --serial=1
```

### User Requirements for Swapping

Before users can swap, they need:

1. **Output token association** - Associate the new NFT token with their account
2. **NFT allowance to contract** - Grant the contract permission to transfer their old NFT
3. **HBAR allowance to contract** - Grant 1 tinybar allowance per swap (net cost = 0)

```javascript
// Example: Set up user for swapping (Hedera SDK)
// 1. Associate output token
await new TokenAssociateTransaction()
  .setAccountId(userAccountId)
  .setTokenIds([outputTokenId])
  .execute(client);

// 2. Grant NFT allowance
await new AccountAllowanceApproveTransaction()
  .approveTokenNftAllowanceAllSerials(inputTokenId, userAccountId, contractAccountId)
  .execute(client);

// 3. Grant HBAR allowance (1 tinybar per swap)
await new AccountAllowanceApproveTransaction()
  .approveHbarAllowance(userAccountId, contractAccountId, Hbar.fromTinybars(100))
  .execute(client);
```

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
- [ ] Contract funded with HBAR (for tinybar operations)
- [ ] Output token(s) associated with contract
- [ ] Output NFTs transferred to contract
- [ ] Swap configurations loaded
- [ ] Treasury HBAR allowance set (for treasury flow)
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
- For treasury flow: check treasury has HBAR allowance
- Verify NFT serial exists and is owned by expected party

### "ConfigNotFound" Error
- Swap configuration not loaded for this input token/serial
- Config may have been consumed by a previous swap (one-time use)

### "GraveyardStakeFailed" Error
- Graveyard contract must be associated with input token
- UTS must be registered as contract user of graveyard (if required)
- Check graveyard is not paused
