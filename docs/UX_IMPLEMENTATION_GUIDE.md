# Token Swap UX Implementation Guide

> Comprehensive guide for frontend developers integrating with the Lazy Superheroes NFT Swap contracts.

**Last Updated:** 2025-12-31
**Contract Version:** 1.0.0
**Network:** Hedera Hashgraph (Mainnet/Testnet)

---

## Table of Contents

1. [Overview](#1-overview)
2. [UnifiedTokenSwap (Recommended)](#2-unifiedtokenswap-recommended)
3. [Legacy: NoFallbackTokenSwap](#3-legacy-nofallbacktokenswap)
4. [Legacy: FallbackTokenSwap](#4-legacy-fallbacktokenswap)
5. [Events Reference](#5-events-reference)
6. [Error Handling](#6-error-handling)
7. [Mirror Node Queries](#7-mirror-node-queries)
8. [Complete User Flow Examples](#8-complete-user-flow-examples)

---

## 1. Overview

### Contract Comparison

| Feature | UnifiedTokenSwap | NoFallbackTokenSwap | FallbackTokenSwap |
|---------|------------------|---------------------|-------------------|
| Multi-Token Support | Yes | Single output token | Single output token |
| LAZY Rewards | No | Yes (via LGS) | Yes (via LGS) |
| Graveyard Integration | Optional per-config | No | No |
| Treasury Destination | Per-config | Global | Global |
| Royalty Bypass | HBAR tinybar | N/A | LAZY tinybar |
| Multi-Admin | Yes | Single owner | Single owner |
| Batch Size Limit | 255 (varies by flow) | 5 per batch | 8 per batch |

### When to Use Which Contract

- **UnifiedTokenSwap**: Use for new projects, multi-collection swaps, or when graveyard integration is needed
- **NoFallbackTokenSwap**: Use for LAZY-specific swaps without royalty concerns
- **FallbackTokenSwap**: Use for LAZY-specific swaps where old NFTs have fallback fees

---

## 2. UnifiedTokenSwap (Recommended)

### 2.1 Contract Purpose

A universal NFT swap contract supporting:
- Multiple input/output token combinations
- HBAR-based royalty bypass for tokens with fallback fees
- Optional Token Graveyard integration for permanent NFT disposal
- Multi-admin governance
- Per-swap configuration (each input NFT maps to specific output)

### 2.2 State Variables (Read-Only)

```solidity
// Check if contract is paused
bool public paused;

// Get graveyard contract address
ITokenGraveyard public graveyard;

// Get swap configuration for a specific input
mapping(bytes32 => SwapConfig) public swapConfigs;
```

### 2.2.1 Token Association Queries

```javascript
// Check if a token is associated with the contract
const isAssociated = await contract.isTokenAssociated(tokenAddress);

// Get all output tokens (tokens distributed to users)
const outputTokens = await contract.getOutputTokens();

// Get all input tokens (graveyard flow tokens)
const inputTokens = await contract.getInputTokens();
```

**Note:** `isTokenAssociated()` returns `true` if the token is tracked in either the input or output token sets. This is useful for frontends to verify contract readiness before attempting swaps.

### 2.2.2 Auto-Association Behavior (Admin)

When adding swap configurations with `useGraveyard = true`, the contract **automatically associates input tokens** if they're not already tracked. This is transparent to end users but admins should be aware:

- **Gas consideration:** Add ~950,000 extra gas per new input token being auto-associated
- **Efficiency:** The contract checks both input and output token sets (O(1) lookups) before attempting association
- **Idempotent:** Safe to add multiple configs for the same input token - association only happens once

```javascript
// Admin: When adding graveyard configs, use higher gas limit
const gasLimit = 500_000 + (newTokenCount * 950_000);
await contract.addSwapConfigs(inputTokens, inputSerials, configs, { gasLimit });
```

### 2.3 Key Functions

#### Check if User Can Swap

```javascript
// 1. Verify contract is not paused
const paused = await contract.paused();
if (paused) {
  showError("Swap contract is currently paused");
  return;
}

// 2. Check if swap config exists for user's NFTs
const inputTokens = [nft1.tokenAddress, nft2.tokenAddress];
const inputSerials = [nft1.serial, nft2.serial];

const configs = await contract.getSwapConfigs(inputTokens, inputSerials);
for (let i = 0; i < configs.length; i++) {
  if (configs[i].outputToken === '0x0000000000000000000000000000000000000000') {
    showError(`No swap configured for ${inputTokens[i]} serial ${inputSerials[i]}`);
    return;
  }
}
```

#### Execute Swap

```javascript
// Function signature
function swapNFTs(
  address[] calldata inputTokens,
  uint256[] calldata inputSerials
) external

// Example call (ethers.js v6)
const tx = await contract.swapNFTs(
  inputTokenAddresses,  // Array of EVM addresses
  inputSerials          // Array of serial numbers (uint256)
);
const receipt = await tx.wait();
```

### 2.4 User Prerequisites

Before calling `swapNFTs`, the user MUST:

1. **Associate output tokens** (Hedera native operation)
   - Check each unique `outputToken` from configs
   - User must have each output token associated

2. **Grant NFT allowance** to the contract
   - For **both flows**: User grants NFT allowance to the contract
   - The contract pulls the old NFT first, then routes it appropriately

```javascript
// Using Hedera SDK - NFT allowance
const nftAllowanceTx = await new AccountAllowanceApproveTransaction()
  .approveTokenNftAllowanceAllSerials(
    TokenId.fromSolidityAddress(inputTokenAddress),
    userAccountId,
    ContractId.fromSolidityAddress(contractAddress)
  )
  .execute(client);
```

3. **Grant HBAR allowance** to the contract
   - Required for **both flows** (treasury and graveyard)
   - User pays 1 tinybar back to contract in step 3 of the swap
   - Net cost to user = 0 (receives 1 tinybar in step 1, pays 1 back in step 3)

```javascript
// Using Hedera SDK - HBAR allowance (1 tinybar per swap)
const hbarAllowanceTx = await new AccountAllowanceApproveTransaction()
  .approveHbarAllowance(
    userAccountId,
    ContractId.fromSolidityAddress(contractAddress),
    Hbar.fromTinybars(100)  // Allow 100 swaps
  )
  .execute(client);
```

### 2.5 Swap Flow Diagrams

#### Treasury Flow (useGraveyard = false)
```
User                    Contract                Treasury
  |                         |                       |
  |--- swapNFTs() --------->|                       |
  |                         |                       |
  | [STEP 1: Pull Old NFT]  |                       |
  |  Old NFT: User -------->| Contract              |
  |  HBAR: Contract ------->| 1 tinybar --> User    |
  |                         |                       |
  | [STEP 2: Send to Treasury]                      |
  |                         |  Old NFT ------------>| Treasury
  |                         |  HBAR: 1 tinybar ---->| Treasury
  |                         |                       |
  | [STEP 3: Send New NFT]  |                       |
  |  New NFT: Contract ---->| User                  |
  |  HBAR: User ----------->| 1 tinybar --> Contract|
  |                         |                       |
  |<-- SwapEvent -----------|                       |

User net HBAR: 0 (received 1, paid 1)
Contract net HBAR: -1 per swap (funded by HBAR balance)
```

#### Graveyard Flow (useGraveyard = true)
```
User                    Contract               Graveyard
  |                         |                       |
  |--- swapNFTs() --------->|                       |
  |                         |                       |
  | [STEP 1: Pull Old NFT]  |                       |
  |  Old NFT: User -------->| Contract              |
  |  HBAR: Contract ------->| 1 tinybar --> User    |
  |                         |                       |
  | [STEP 2: Bury in Graveyard]                     |
  |                         |  Approve NFT          |
  |                         |--- stakeNFTsToTheGrave -->|
  |                         |                       |
  | [STEP 3: Send New NFT]  |                       |
  |  New NFT: Contract ---->| User                  |
  |  HBAR: User ----------->| 1 tinybar --> Contract|
  |                         |                       |
  |<-- SwapEvent -----------|                       |

User net HBAR: 0 (received 1, paid 1)
Contract net HBAR: 0 per swap (pays 1, receives 1)
```

### 2.6 Response Structure

The `swapNFTs` function emits events but doesn't return values directly. Monitor the transaction receipt for:

```javascript
// Parse events from receipt
const events = receipt.logs.map(log => {
  try {
    return contract.interface.parseLog(log);
  } catch {
    return null;
  }
}).filter(Boolean);

// Each swap emits a SwapEvent
events.forEach(event => {
  if (event.name === 'SwapEvent') {
    console.log({
      user: event.args.user,
      inputToken: event.args.inputToken,
      inputSerial: event.args.inputSerial,
      outputToken: event.args.outputToken,
      outputSerial: event.args.outputSerial,
      message: event.args.message  // "Swapped (Treasury)" or "Swapped (Graveyard)"
    });
  }
});
```

---

## 3. Legacy: NoFallbackTokenSwap

### 3.1 Contract Purpose

Simpler swap contract for LAZY ecosystem projects:
- Single output token collection
- LAZY token rewards per swap
- Works with LazyGasStation for LAZY distribution
- No royalty bypass mechanism (use for non-royalty NFTs)

### 3.2 State Variables

```solidity
address public swapToken;           // Output NFT collection
address public swapTokenTreasury;   // Where old NFTs go
address public lazyToken;           // $LAZY token address
uint256 public lazyPmtAmt;          // LAZY reward per swap
bool public paused;                 // Pause status
```

### 3.3 Key Functions

#### Check Eligibility

```javascript
// 1. Check pause status
const paused = await contract.paused();

// 2. Get new serials for input NFTs
// First, compute the swap hashes
const swapHashes = inputNfts.map(nft =>
  ethers.solidityPackedKeccak256(
    ['address', 'uint256'],
    [nft.tokenAddress, nft.serial]
  )
);

// Then query the contract
const newSerials = await contract.getSerials(swapHashes);

// Check each result (0 means not configured)
newSerials.forEach((serial, i) => {
  if (serial === 0n) {
    console.log(`NFT ${inputNfts[i].serial} is not eligible for swap`);
  }
});
```

#### Execute Swap

```javascript
// Function signature
function swapNFTs(
  address[] calldata tokensToSwap,
  uint256[] calldata serials
) external returns (uint256 amt)  // Returns LAZY amount received

// Example
const tx = await contract.swapNFTs(tokenAddresses, serialNumbers);
const receipt = await tx.wait();

// Get LAZY amount from return value or event
```

### 3.4 User Prerequisites

1. **Associate output token** (swapToken)
2. **Associate $LAZY token** if not already
3. **Grant NFT allowance** to treasury address (not contract!)

```javascript
// For NoFallbackTokenSwap, allowance goes to TREASURY
const treasury = await contract.swapTokenTreasury();

const allowanceTx = await new AccountAllowanceApproveTransaction()
  .approveTokenNftAllowanceAllSerials(
    inputTokenId,
    userAccountId,
    AccountId.fromSolidityAddress(treasury)
  )
  .execute(client);
```

### 3.5 Important Limitations

- **Batch size**: Maximum 5 NFTs per transaction (due to 10-leg transfer limit)
- **No royalty bypass**: Don't use for NFTs with fallback fees
- **Group by token**: For efficiency, group NFTs by token ID in the input arrays

---

## 4. Legacy: FallbackTokenSwap

### 4.1 Contract Purpose

Enhanced swap contract for NFTs with fallback fees:
- Built-in royalty bypass using LAZY tinybar transfers
- Auto-refill from LazyGasStation when LAZY balance low
- Three-phase transfer process to handle fallback fees

### 4.2 State Variables

```solidity
address public swapToken;           // Output NFT collection
address public swapTokenTreasury;   // Where old NFTs go
address public lazyToken;           // $LAZY token address
uint256 public lazyPmtAmt;          // LAZY reward per swap
bool public paused;                 // Pause status
```

### 4.3 Key Functions

Same interface as NoFallbackTokenSwap:

```javascript
// Check eligibility
const serials = await contract.getSerials(swapHashes);

// Execute swap
const tx = await contract.swapNFTs(tokenAddresses, serialNumbers);
```

### 4.4 User Prerequisites

1. **Associate output token** (swapToken)
2. **Associate $LAZY token**
3. **Grant NFT allowance** to CONTRACT address
4. **Set $LAZY allowance** to contract for royalty bypass

```javascript
// NFT allowance to CONTRACT (not treasury!)
const allowanceTx = await new AccountAllowanceApproveTransaction()
  .approveTokenNftAllowanceAllSerials(
    inputTokenId,
    userAccountId,
    contractAccountId
  )
  .execute(client);

// LAZY allowance (1 token covers ~8 swaps)
const lazyAllowance = await new AccountAllowanceApproveTransaction()
  .approveTokenAllowance(
    lazyTokenId,
    userAccountId,
    contractAccountId,
    Math.ceil(nftCount / 8)  // 1 LAZY unit per 8 NFTs
  )
  .execute(client);
```

### 4.5 Transfer Flow

FallbackTokenSwap performs 3 separate transfer operations per batch:

```
Phase 1: User -> Contract (with LAZY tinybar to defeat royalty)
Phase 2: Contract -> Treasury (with LAZY tinybar)
Phase 3: Contract -> User (new NFT, with LAZY tinybar)

Then: LazyGasStation pays LAZY rewards to user
```

### 4.6 Important Limitations

- **Batch size**: Maximum 8 NFTs per transaction
- **LAZY balance**: Contract auto-refills when balance < 20
- **Treasury LAZY**: Treasury must have $LAZY associated and some balance

---

## 5. Events Reference

### 5.1 UnifiedTokenSwap Events

#### SwapEvent
Primary event for all swap activity and admin actions.

```solidity
event SwapEvent(
    address indexed user,
    address indexed inputToken,
    uint256 inputSerial,
    address indexed outputToken,
    uint256 outputSerial,
    string message
);
```

**Event Scenarios:**

| Scenario | user | inputToken | inputSerial | outputToken | outputSerial | message |
|----------|------|------------|-------------|-------------|--------------|---------|
| NFT Swap (Treasury) | swapper | old token | old serial | new token | new serial | "Swapped (Treasury)" |
| NFT Swap (Graveyard) | swapper | old token | old serial | new token | new serial | "Swapped (Graveyard)" |
| NFTs Staked | staker | token | count | contract | 0 | "NFTs Staked" |
| Pause | admin | 0x0 | 0 | 0x0 | 0 | "PAUSED" |
| Unpause | admin | 0x0 | 0 | 0x0 | 0 | "UNPAUSED" |
| HBAR Received | sender | 0x0 | amount | 0x0 | 0 | "Hbar Received" |
| HBAR Transfer | receiver | 0x0 | amount | 0x0 | 0 | "Hbar Transfer" |

#### AdminChanged
Admin role changes.

```solidity
event AdminChanged(address indexed admin, bool indexed added);
```

| Field | Description |
|-------|-------------|
| admin | Address affected |
| added | true = added, false = removed |

### 5.2 Legacy Contract Events

#### TokenSwapEvent (NoFallbackTokenSwap & FallbackTokenSwap)

```solidity
event TokenSwapEvent(
    address indexed user,
    address indexed oldToken,
    uint256 oldSerial,
    address indexed newToken,
    uint256 newSerial,
    string message
);
```

**Event Scenarios:**

| Scenario | user | oldToken | oldSerial | newToken | newSerial | message |
|----------|------|----------|-----------|----------|-----------|---------|
| NFT Swapped | swapper | input token | input serial | output token | output serial | "Swapped" |
| LAZY Sent | swapper | LGS address | 0 | LAZY token | amount | "$LAZY sent" |
| Pause | admin | 0x0 | 0 | 0x0 | 0 | "PAUSED" |
| Unpause | admin | 0x0 | 0 | 0x0 | 0 | "UNPAUSED" |
| HBAR Received | sender | 0x0 | amount | 0x0 | 0 | "Hbar Received by Contract" |
| HBAR Transfer | receiver | 0x0 | amount | 0x0 | 0 | "Hbar Transfer Complete" |

### 5.3 LazyGasStation Events

#### GasStationRefillEvent
Emitted when a contract refills its LAZY/HBAR balance.

```solidity
event GasStationRefillEvent(
    address indexed _callingContract,
    uint256 _amount,
    PaymentType _type  // 0 = Hbar, 1 = Lazy
);
```

#### GasStationFunding
Emitted when LAZY is paid out or drawn from users.

```solidity
event GasStationFunding(
    address indexed _callingContract,
    address indexed _user,
    uint256 _amount,
    uint256 _burnPercentage,
    bool _fromUser  // true = drawn from user, false = paid to user
);
```

#### GasStationAccessControlEvent
Role changes on the gas station.

```solidity
event GasStationAccessControlEvent(
    address indexed _executor,
    address indexed _address,
    bool _added,
    Role _role  // Admin=0, GasStationAuthorizer=1, GasStationContractUser=2
);
```

### 5.4 Event Polling Configuration

For your centralized event poller, subscribe to these topics:

```javascript
// UnifiedTokenSwap
const UNIFIED_SWAP_EVENT = ethers.id("SwapEvent(address,address,uint256,address,uint256,string)");
const ADMIN_CHANGED = ethers.id("AdminChanged(address,bool)");

// Legacy contracts
const TOKEN_SWAP_EVENT = ethers.id("TokenSwapEvent(address,address,uint256,address,uint256,string)");

// LazyGasStation
const GAS_STATION_REFILL = ethers.id("GasStationRefillEvent(address,uint256,uint8)");
const GAS_STATION_FUNDING = ethers.id("GasStationFunding(address,address,uint256,uint256,bool)");
const GAS_STATION_ACCESS = ethers.id("GasStationAccessControlEvent(address,address,bool,uint8)");
```

**Mirror Node Event Query:**

```javascript
const response = await fetch(
  `https://mainnet.mirrornode.hedera.com/api/v1/contracts/${contractId}/results/logs?` +
  `topic0=${UNIFIED_SWAP_EVENT}&order=desc&limit=100`
);
```

---

## 6. Error Handling

### 6.1 UnifiedTokenSwap Errors

| Error | Selector | Cause | User Message |
|-------|----------|-------|--------------|
| `BadInput()` | `0x8927e1e9` | Invalid parameters | "Invalid input parameters" |
| `ExceedsMaxSerials()` | `0x9d8c8da8` | Too many NFTs in batch | "Too many NFTs. Maximum 255 per transaction" |
| `NotAdmin()` | `0x7c214f04` | Caller not admin | "Only admins can perform this action" |
| `CannotRemoveLastAdmin()` | `0xfb47f749` | Trying to remove sole admin | "Cannot remove the last admin" |
| `ConfigNotFound(address,uint256)` | `0x9f7c8f69` | No swap config for input | "This NFT is not eligible for swap" |
| `ContractPaused()` | `0xdfc2d0c5` | Contract is paused | "Swap is currently paused" |
| `AssociationFailed()` | `0x80946813` | Token association failed | "Failed to associate token" |
| `NFTTransferFailed()` | `0x7e273289` | NFT transfer failed | "NFT transfer failed. Check allowances" |
| `GraveyardStakeFailed()` | `0x5e7e0c69` | Graveyard stake failed | "Failed to stake to graveyard" |
| `NFTApprovalFailed(address,uint256,address)` | `0x...` | NFT approval for graveyard failed | "Failed to approve NFT for graveyard" |

### 6.2 Legacy Contract Errors

| Error | Cause | User Message |
|-------|-------|--------------|
| `BadInput()` | Invalid parameters | "Invalid input" |
| `ExceedsMaxSerials()` | Too many NFTs | "Maximum 255 NFTs per transaction" |
| `ConfigNotFound(address,uint256)` | NFT not eligible | "This NFT cannot be swapped" |
| `ContractPaused()` | Contract paused | "Swaps are currently paused" |
| `AssociationFailed()` | Token association failed | "Token association failed" |
| `NFTTransferFailed()` | Transfer failed | "NFT transfer failed" |
| `NFTEOA2SCTransferFailed()` | User->Contract failed | "Could not receive NFT. Check allowances" |
| `NFTSC2TreasuryTransferFailed()` | Contract->Treasury failed | "Transfer to treasury failed" |
| `NFTSC2EOATransferFailed()` | Contract->User failed | "Could not send new NFT" |
| `FTTransferFailed()` | LAZY transfer failed | "LAZY reward payment failed" |
| `StakingFailed()` | Staking NFTs failed | "Failed to stake NFTs" |

### 6.3 Error Handling Code Example

```javascript
import { ethers } from 'ethers';

// Custom error interface
const errorInterface = new ethers.Interface([
  "error BadInput()",
  "error ExceedsMaxSerials()",
  "error ConfigNotFound(address token, uint256 serial)",
  "error ContractPaused()",
  "error NFTTransferFailed()",
  "error GraveyardStakeFailed()",
  "error NFTApprovalFailed(address token, uint256 serial, address spender)"
]);

async function executeSwap(contract, tokens, serials) {
  try {
    const tx = await contract.swapNFTs(tokens, serials);
    const receipt = await tx.wait();
    return { success: true, receipt };
  } catch (error) {
    // Parse custom error
    if (error.data) {
      try {
        const decoded = errorInterface.parseError(error.data);
        switch (decoded.name) {
          case 'ConfigNotFound':
            return {
              success: false,
              error: `NFT ${decoded.args.token} #${decoded.args.serial} is not eligible for swap`
            };
          case 'ContractPaused':
            return { success: false, error: 'Swaps are currently paused' };
          case 'NFTTransferFailed':
            return { success: false, error: 'Please check your NFT allowances' };
          case 'NFTApprovalFailed':
            return { success: false, error: 'Failed to approve NFT for graveyard transfer' };
          default:
            return { success: false, error: decoded.name };
        }
      } catch {
        // Not a custom error
      }
    }
    return { success: false, error: error.message };
  }
}
```

---

## 7. Mirror Node Queries

### 7.1 Check Token Association

```javascript
async function isTokenAssociated(accountId, tokenId, network = 'mainnet') {
  const url = `https://${network}.mirrornode.hedera.com/api/v1/accounts/${accountId}/tokens?token.id=${tokenId}`;
  const response = await fetch(url);
  const data = await response.json();
  return data.tokens && data.tokens.length > 0;
}
```

### 7.2 Get User's NFTs for Eligible Swap

```javascript
async function getUserEligibleNFTs(accountId, eligibleTokenIds, network = 'mainnet') {
  const results = [];

  for (const tokenId of eligibleTokenIds) {
    const url = `https://${network}.mirrornode.hedera.com/api/v1/accounts/${accountId}/nfts?token.id=${tokenId}&limit=100`;
    const response = await fetch(url);
    const data = await response.json();

    if (data.nfts) {
      results.push(...data.nfts.map(nft => ({
        tokenId: nft.token_id,
        serial: nft.serial_number,
        metadata: nft.metadata
      })));
    }
  }

  return results;
}
```

### 7.3 Check NFT Allowances

```javascript
async function getNFTAllowances(accountId, network = 'mainnet') {
  const url = `https://${network}.mirrornode.hedera.com/api/v1/accounts/${accountId}/allowances/nfts`;
  const response = await fetch(url);
  const data = await response.json();
  return data.allowances || [];
}

async function hasAllowanceForContract(accountId, tokenId, spenderId, network = 'mainnet') {
  const allowances = await getNFTAllowances(accountId, network);
  return allowances.some(a =>
    a.token_id === tokenId &&
    a.spender === spenderId &&
    a.approved_for_all === true
  );
}
```

### 7.4 Get Contract Events

```javascript
async function getSwapEvents(contractId, fromTimestamp, network = 'mainnet') {
  const topic0 = ethers.id("SwapEvent(address,address,uint256,address,uint256,string)");
  const url = `https://${network}.mirrornode.hedera.com/api/v1/contracts/${contractId}/results/logs?` +
    `topic0=${topic0}&timestamp=gte:${fromTimestamp}&order=asc&limit=100`;

  const response = await fetch(url);
  const data = await response.json();

  return data.logs.map(log => {
    // Decode the event
    const decoded = eventInterface.parseLog({
      topics: log.topics,
      data: log.data
    });
    return {
      timestamp: log.timestamp,
      user: decoded.args.user,
      inputToken: decoded.args.inputToken,
      inputSerial: decoded.args.inputSerial.toString(),
      outputToken: decoded.args.outputToken,
      outputSerial: decoded.args.outputSerial.toString(),
      message: decoded.args.message
    };
  });
}
```

---

## 8. Complete User Flow Examples

### 8.1 UnifiedTokenSwap - Full Flow

```javascript
import { ethers } from 'ethers';
import { Client, AccountAllowanceApproveTransaction, TokenId, AccountId } from '@hashgraph/sdk';

async function performUnifiedSwap(userNFTs, contract, hederaClient) {
  // Step 1: Check contract status
  const paused = await contract.paused();
  if (paused) {
    throw new Error('Contract is paused');
  }

  // Step 2: Get swap configurations
  const inputTokens = userNFTs.map(n => n.tokenAddress);
  const inputSerials = userNFTs.map(n => n.serial);

  const configs = await contract.getSwapConfigs(inputTokens, inputSerials);

  // Step 3: Validate all NFTs are eligible
  const outputTokensNeeded = new Set();
  for (let i = 0; i < configs.length; i++) {
    if (configs[i].outputToken === ethers.ZeroAddress) {
      throw new Error(`NFT ${inputTokens[i]} #${inputSerials[i]} is not eligible`);
    }
    outputTokensNeeded.add(configs[i].outputToken);
  }

  // Step 4: Check and set up token associations
  for (const outputToken of outputTokensNeeded) {
    const isAssociated = await isTokenAssociated(
      userAccountId.toString(),
      TokenId.fromSolidityAddress(outputToken).toString()
    );
    if (!isAssociated) {
      // Prompt user to associate token
      await associateToken(hederaClient, TokenId.fromSolidityAddress(outputToken));
    }
  }

  // Step 5: Set up NFT allowances
  const uniqueInputTokens = [...new Set(inputTokens)];
  for (const token of uniqueInputTokens) {
    const hasAllowance = await hasAllowanceForContract(
      userAccountId.toString(),
      TokenId.fromSolidityAddress(token).toString(),
      contractAccountId.toString()
    );

    if (!hasAllowance) {
      const tx = await new AccountAllowanceApproveTransaction()
        .approveTokenNftAllowanceAllSerials(
          TokenId.fromSolidityAddress(token),
          userAccountId,
          contractAccountId
        )
        .execute(hederaClient);
      await tx.getReceipt(hederaClient);
    }
  }

  // Step 6: Execute swap
  const tx = await contract.swapNFTs(inputTokens, inputSerials);
  const receipt = await tx.wait();

  // Step 7: Parse results
  const swapResults = [];
  for (const log of receipt.logs) {
    try {
      const event = contract.interface.parseLog(log);
      if (event.name === 'SwapEvent' && event.args.message.includes('Swapped')) {
        swapResults.push({
          inputToken: event.args.inputToken,
          inputSerial: event.args.inputSerial.toString(),
          outputToken: event.args.outputToken,
          outputSerial: event.args.outputSerial.toString(),
          method: event.args.message
        });
      }
    } catch {}
  }

  return {
    transactionId: receipt.transactionHash,
    swaps: swapResults
  };
}
```

### 8.2 Legacy FallbackTokenSwap - Full Flow

```javascript
async function performLegacySwap(userNFTs, contract, hederaClient) {
  // Step 1: Check pause status
  if (await contract.paused()) {
    throw new Error('Contract is paused');
  }

  // Step 2: Get swap info
  const swapToken = await contract.swapToken();
  const lazyToken = await contract.lazyToken();
  const lazyPmtAmt = await contract.lazyPmtAmt();

  // Step 3: Compute swap hashes and check eligibility
  const swapHashes = userNFTs.map(nft =>
    ethers.solidityPackedKeccak256(
      ['address', 'uint256'],
      [nft.tokenAddress, nft.serial]
    )
  );

  const newSerials = await contract.getSerials(swapHashes);
  const eligibleNFTs = userNFTs.filter((_, i) => newSerials[i] > 0n);

  if (eligibleNFTs.length === 0) {
    throw new Error('None of the selected NFTs are eligible for swap');
  }

  // Step 4: Check token associations
  const needsSwapToken = !(await isTokenAssociated(userAccountId.toString(), swapToken));
  const needsLazyToken = !(await isTokenAssociated(userAccountId.toString(), lazyToken));

  if (needsSwapToken || needsLazyToken) {
    const tokensToAssociate = [];
    if (needsSwapToken) tokensToAssociate.push(TokenId.fromSolidityAddress(swapToken));
    if (needsLazyToken) tokensToAssociate.push(TokenId.fromSolidityAddress(lazyToken));
    await associateTokens(hederaClient, tokensToAssociate);
  }

  // Step 5: Set NFT allowance (to CONTRACT for FallbackTokenSwap)
  const uniqueTokens = [...new Set(eligibleNFTs.map(n => n.tokenAddress))];
  for (const token of uniqueTokens) {
    await setNFTAllowance(hederaClient, token, contractAccountId);
  }

  // Step 6: Set LAZY allowance for royalty bypass
  // Need 1 unit per 8 NFTs (ceiling)
  const lazyAllowanceNeeded = Math.ceil(eligibleNFTs.length / 8);
  await setFTAllowance(hederaClient, lazyToken, contractAccountId, lazyAllowanceNeeded);

  // Step 7: Execute swap
  const tx = await contract.swapNFTs(
    eligibleNFTs.map(n => n.tokenAddress),
    eligibleNFTs.map(n => n.serial)
  );
  const receipt = await tx.wait();

  // Step 8: Calculate expected LAZY rewards
  const expectedLazy = BigInt(eligibleNFTs.length) * lazyPmtAmt;

  return {
    transactionId: receipt.transactionHash,
    nftsSwapped: eligibleNFTs.length,
    expectedLazyReward: ethers.formatUnits(expectedLazy, 1)  // LAZY has 1 decimal
  };
}
```

### 8.3 UI State Machine

```
┌─────────────────────────────────────────────────────────────────┐
│                          IDLE                                    │
│  [Connect Wallet Button]                                        │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     LOADING_NFTS                                 │
│  "Loading your NFTs..."                                         │
│  - Fetch user's NFTs from mirror node                           │
│  - Check swap eligibility for each                              │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      NFT_SELECTION                               │
│  Display eligible NFTs with checkboxes                          │
│  Show: old NFT image → new NFT preview                          │
│  [Select All] [Deselect All]                                    │
│  [Continue Button] (disabled if none selected)                  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    PREREQUISITES_CHECK                           │
│  Checking requirements...                                        │
│  ☐ Token associations                                           │
│  ☐ NFT allowances                                               │
│  ☐ LAZY allowance (if FallbackTokenSwap)                        │
│  [Fix Issues] or [Continue to Swap]                             │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      SETTING_ALLOWANCES                          │
│  "Setting up permissions..."                                     │
│  Progress bar for each transaction                              │
│  - Associate tokens (if needed)                                  │
│  - Set NFT allowances                                            │
│  - Set LAZY allowance (if needed)                                │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      CONFIRM_SWAP                                │
│  Summary:                                                        │
│  - X NFTs to swap                                               │
│  - Y LAZY tokens expected (legacy contracts)                     │
│  - Estimated gas: ~Z HBAR                                        │
│  [Confirm Swap] [Cancel]                                         │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      SWAPPING                                    │
│  "Processing your swap..."                                       │
│  Transaction submitted: 0.0.XXX@timestamp                       │
│  [View on HashScan]                                             │
└─────────────────────────────────────────────────────────────────┘
                              │
                    ┌─────────┴─────────┐
                    ▼                   ▼
┌───────────────────────┐   ┌───────────────────────┐
│        SUCCESS        │   │         ERROR         │
│  Swap complete!       │   │  Swap failed          │
│  Received:            │   │  Reason: [message]    │
│  - X new NFTs         │   │  [Try Again]          │
│  - Y LAZY tokens      │   │  [Back to Selection]  │
│  [View NFTs] [Done]   │   │                       │
└───────────────────────┘   └───────────────────────┘
```

---

## Appendix A: Contract ABIs

### UnifiedTokenSwap ABI (Key Functions)

```json
[
  "function paused() view returns (bool)",
  "function graveyard() view returns (address)",
  "function getSwapConfigs(address[] inputTokens, uint256[] inputSerials) view returns (tuple(address outputToken, address treasury, bool useGraveyard, uint256 outputSerial)[])",
  "function getOutputTokens() view returns (address[])",
  "function getInputTokens() view returns (address[])",
  "function isTokenAssociated(address token) view returns (bool)",
  "function getAdmins() view returns (address[])",
  "function isAdmin(address) view returns (bool)",
  "function swapNFTs(address[] inputTokens, uint256[] inputSerials)",
  "function stakeNFTs(address token, uint256[] serials)",
  "function unstakeNFTs(address token, uint256[] serials, address receiver)",
  "function addAdmin(address admin)",
  "function removeAdmin(address admin)",
  "function addOutputToken(address token)",
  "function addSwapConfigs(address[] inputTokens, uint256[] inputSerials, tuple(address outputToken, address treasury, bool useGraveyard, uint256 outputSerial)[] configs)",
  "function removeSwapConfigs(address[] inputTokens, uint256[] inputSerials)",
  "function updateGraveyard(address graveyard)",
  "function updatePauseStatus(bool paused) returns (bool changed)",
  "function transferHbar(address receiverAddress, uint256 amount)",
  "event SwapEvent(address indexed user, address indexed inputToken, uint256 inputSerial, address indexed outputToken, uint256 outputSerial, string message)",
  "event AdminChanged(address indexed admin, bool indexed added)"
]
```

### NoFallbackTokenSwap / FallbackTokenSwap ABI (Key Functions)

```json
[
  "function paused() view returns (bool)",
  "function swapToken() view returns (address)",
  "function swapTokenTreasury() view returns (address)",
  "function lazyToken() view returns (address)",
  "function lazyPmtAmt() view returns (uint256)",
  "function getSerials(bytes32[] swapHashes) view returns (uint256[])",
  "function swapNFTs(address[] tokensToSwap, uint256[] serials) returns (uint256)",
  "event TokenSwapEvent(address indexed user, address indexed oldToken, uint256 oldSerial, address indexed newToken, uint256 newSerial, string message)"
]
```

---

## Appendix B: Network Addresses

### Mainnet

| Contract | Address |
|----------|---------|
| $LAZY Token | `0.0.731861` |
| LazyGasStation | _Deployment specific_ |
| Token Graveyard | _Deployment specific_ |

### Testnet

| Contract | Address |
|----------|---------|
| $LAZY Token | _Check .env_ |
| LazyGasStation | _Deployment specific_ |
| Token Graveyard | _Deployment specific_ |

---

*Document generated for Lazy Superheroes development team.*
