# Hedera Solidity Development Guide

Comprehensive guide for Hedera smart contract development, capturing patterns, nuances, and best practices learned from real-world projects.

**Target Audience**: Claude (AI assistant) working on Hedera projects
**Purpose**: Ensure consistent, correct Hedera development across projects
**Portability**: Copy this file to any Hedera project root

---

## Table of Contents

1. [Critical Differences from Ethereum](#1-critical-differences-from-ethereum)
2. [Mirror Node Architecture](#2-mirror-node-architecture)
3. [Transaction ID Formats](#3-transaction-id-formats)
4. [HTS Tokens vs ERC-20](#4-hts-tokens-vs-erc-20)
5. [Token Association](#5-token-association)
6. [Allowances and the Storage Contract Pattern](#6-allowances-and-the-storage-contract-pattern)
7. [NFT Transfers with Allowances](#7-nft-transfers-with-allowances)
8. [Client Setup and Environment](#8-client-setup-and-environment)
9. [Ethers.js Integration](#9-ethersjs-integration)
10. [Mirror Node Queries](#10-mirror-node-queries)
11. [Contract Interaction Patterns](#11-contract-interaction-patterns)
12. [Gas Estimation and Limits](#12-gas-estimation-and-limits)
13. [Error Handling](#13-error-handling)
14. [Testing Patterns](#14-testing-patterns)
15. [Multi-Signature Considerations](#15-multi-signature-considerations)
16. [Account and Address Formats](#16-account-and-address-formats)
17. [PRNG (Random Numbers)](#17-prng-random-numbers)
18. [Common Pitfalls](#18-common-pitfalls)

---

## 1. Critical Differences from Ethereum

**STOP AND READ THIS FIRST.** These are the most common mistakes when applying Ethereum knowledge to Hedera:

| Aspect | Ethereum | Hedera |
|--------|----------|--------|
| Token transfers | Just send | Must **associate** token first |
| Allowances | Approve the contract you're calling | May need to approve a **different** contract (storage pattern) |
| Reading data | Call the node (costs gas) | Use **mirror node** (free) |
| Transaction records | Available immediately | Wait **5+ seconds** for mirror node |
| Account format | 0x address only | `0.0.XXXXX` AND 0x address |
| Token standard | ERC-20/721 | HTS (Hedera Token Service) via precompile |
| RPC endpoints | Standard JSON-RPC | Hedera SDK + Mirror Node REST API |
| NFT allowance transfers | Just use allowance | Must set `isApproval = true` in HTS call |

---

## 2. Mirror Node Architecture

### Understanding the Difference

- **Consensus Network**: The actual Hedera network where transactions execute. Queries cost gas/fees. Requires signing.
- **Mirror Node**: A read-only copy of the network state. Queries are **free**. No signing required.

### When to Use Each

| Use Case | Use Mirror Node | Use Consensus |
|----------|-----------------|---------------|
| Read contract state | Yes (free) | Avoid (costs gas) |
| Get transaction receipt | Yes (after delay) | Only if immediate |
| Get transaction record | Yes (free) | Requires signing |
| Execute transactions | No | Yes |
| Real-time data | No (5s delay) | Yes |

### Mirror Node URLs

```javascript
function getBaseURL(env) {
    const envLower = env.toLowerCase();
    if (envLower === 'test' || envLower === 'testnet') {
        return 'https://testnet.mirrornode.hedera.com';
    }
    else if (envLower === 'main' || envLower === 'mainnet') {
        return 'https://mainnet-public.mirrornode.hedera.com';
    }
    else if (envLower === 'preview' || envLower === 'previewnet') {
        return 'https://previewnet.mirrornode.hedera.com';
    }
    else if (envLower === 'local') {
        return 'http://localhost:8000';
    }
    throw new Error(`Unknown environment: ${env}`);
}
```

### Key Mirror Node Endpoints

| Endpoint | Purpose |
|----------|---------|
| `/api/v1/accounts/{id}` | Account balance, info |
| `/api/v1/accounts/{id}/tokens` | Token balances |
| `/api/v1/accounts/{id}/allowances/tokens` | FT allowances |
| `/api/v1/accounts/{id}/allowances/nfts` | NFT approvals |
| `/api/v1/contracts/call` | Read-only EVM calls (free!) |
| `/api/v1/contracts/results/{txId}` | Contract execution results |
| `/api/v1/contracts/{id}/results/logs` | Contract events |
| `/api/v1/transactions/{txId}` | Transaction status |
| `/api/v1/tokens/{id}` | Token details |

### Mirror Node Propagation Delay

**CRITICAL**: After a transaction executes, wait **5 seconds minimum** before querying mirror node.

```javascript
async function getContractResultWithRetry(env, transactionId, options = {}) {
    const {
        initialDelay = 5000,  // 5 seconds - critical for mirror propagation
        retryDelay = 3000,    // 3 seconds between retries
        maxRetries = 10,
    } = options;

    console.log(`Waiting ${initialDelay / 1000}s for mirror node propagation...`);
    await new Promise(resolve => setTimeout(resolve, initialDelay));

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const result = await queryMirrorNode(env, transactionId);
            if (result.success) return result;
        } catch (e) {
            // Continue retrying
        }

        if (attempt < maxRetries) {
            await new Promise(resolve => setTimeout(resolve, retryDelay));
        }
    }

    throw new Error('Transaction not available on mirror node after retries');
}
```

---

## 3. Transaction ID Formats

Hedera has TWO transaction ID formats. Converting between them is essential.

### SDK Format (Used by Hedera SDK)
```
0.0.1234@1234567890.123456789
```
Format: `{accountId}@{seconds}.{nanoseconds}`

### Mirror Node Format (Used in REST API)
```
0.0.1234-1234567890-123456789
```
Format: `{accountId}-{seconds}-{nanoseconds}`

### Conversion Function

```javascript
function formatTransactionIdForMirror(transactionIdStr) {
    if (!transactionIdStr) return transactionIdStr;

    // Already in mirror format
    if (!transactionIdStr.includes('@')) {
        return transactionIdStr;
    }

    // Convert from SDK format to mirror format
    const parts = transactionIdStr.split('@');
    if (parts.length !== 2) return transactionIdStr;

    const timeParts = parts[1].split('.');
    if (timeParts.length !== 2) return transactionIdStr;

    return `${parts[0]}-${timeParts[0]}-${timeParts[1]}`;
}
```

---

## 4. HTS Tokens vs ERC-20

Hedera Token Service (HTS) is **NOT** ERC-20, even though Hedera has EVM compatibility.

### Key Differences

| Feature | ERC-20 | HTS |
|---------|--------|-----|
| Implementation | Smart contract | Native precompile (0x167) |
| Association | Not required | **Required before receiving** |
| Allowances | Standard approve() | Via SDK or precompile |
| Response codes | Revert on failure | Status codes (check!) |
| Gas cost | Higher | Lower (native operation) |

### HTS Precompile Address

```solidity
address constant HTS_PRECOMPILE = address(0x167);
```

### Checking HTS Response Codes

**Always check response codes** - HTS operations don't always revert on failure:

```solidity
// In Solidity
import "./HederaResponseCodes.sol";

int responseCode = HederaTokenService.transferToken(token, from, to, amount);
require(responseCode == HederaResponseCodes.SUCCESS, "Transfer failed");
```

```javascript
// In JavaScript - check receipt status
const receipt = await transaction.getReceipt(client);
if (receipt.status.toString() !== 'SUCCESS') {
    throw new Error(`HTS operation failed: ${receipt.status}`);
}
```

---

## 5. Token Association

**THIS IS THE #1 GOTCHA FOR ETHEREUM DEVELOPERS**

On Hedera, accounts **MUST associate with a token BEFORE they can receive it**. This is a deliberate anti-spam mechanism.

### Why This Exists

- Prevents spam tokens being sent to accounts
- Account owner must explicitly opt-in to each token
- Accounts have limited auto-association slots

### How to Associate Tokens

```javascript
const { TokenAssociateTransaction } = require('@hashgraph/sdk');

async function associateTokenToAccount(client, accountId, accountKey, tokenId) {
    const transaction = await new TokenAssociateTransaction()
        .setAccountId(accountId)
        .setTokenIds([tokenId])
        .freezeWith(client)
        .sign(accountKey);  // MUST be signed by the receiving account

    const response = await transaction.execute(client);
    const receipt = await response.getReceipt(client);

    return receipt.status.toString();  // Should be 'SUCCESS'
}

// Associate multiple tokens at once
async function associateTokensToAccount(client, accountId, accountKey, tokenIds) {
    const transaction = await new TokenAssociateTransaction()
        .setAccountId(accountId)
        .setTokenIds(tokenIds)
        .freezeWith(client)
        .sign(accountKey);

    const response = await transaction.execute(client);
    const receipt = await response.getReceipt(client);

    return receipt.status.toString();
}
```

### Auto-Association

Accounts can have auto-association slots:

```javascript
const response = await new AccountCreateTransaction()
    .setInitialBalance(new Hbar(10))
    .setMaxAutomaticTokenAssociations(10)  // Auto-associate up to 10 tokens
    .setKey(privateKey.publicKey)
    .execute(client);
```

### Checking Association Status

```javascript
async function isTokenAssociated(env, accountId, tokenId) {
    const baseUrl = getBaseURL(env);
    const url = `${baseUrl}/api/v1/accounts/${accountId}/tokens?token.id=${tokenId}`;

    try {
        const response = await axios.get(url);
        return response.data.tokens.length > 0;
    } catch (e) {
        return false;
    }
}
```

### Association Order

**Critical: Associate tokens BEFORE receiving them:**

```javascript
// WRONG order
await sendNFT(client, aliceId, bobId, tokenId, serials);  // Bob doesn't have token - FAILS
await associateTokensToAccount(client, bobId, bobPK, [tokenId]);

// CORRECT order
await associateTokensToAccount(client, bobId, bobPK, [tokenId]);  // Associate first
await sendNFT(client, aliceId, bobId, tokenId, serials);          // Then send
```

---

## 6. Allowances and the Storage Contract Pattern

**CRITICAL PATTERN**: In many Hedera contracts, users approve tokens to a **STORAGE CONTRACT**, not the main contract they're interacting with.

### Why This Pattern Exists

- Main contracts often delegate HTS operations to a library/storage contract
- The storage contract is the one actually calling `transferFrom()`
- If you approve the wrong contract, transfers will fail

### The Pattern Visualized

```
┌─────────────────┐        ┌──────────────────────┐
│   MainContract  │───────>│  StorageContract     │
│   (Entry Point) │        │  (Does HTS calls)    │
└─────────────────┘        └──────────────────────┘
                                     │
                                     │ transferFrom()
                                     ▼
                           ┌──────────────────────┐
                           │   User's Tokens      │
                           └──────────────────────┘

Users must approve StorageContract, NOT MainContract!
```

### Setting Allowances Correctly

```javascript
const { AccountAllowanceApproveTransaction } = require('@hashgraph/sdk');

// Fungible Token Allowance
async function setFTAllowance(client, tokenId, ownerId, spenderId, amount) {
    const transaction = new AccountAllowanceApproveTransaction()
        .approveTokenAllowance(
            tokenId,
            ownerId,    // Token owner (user)
            spenderId,  // STORAGE CONTRACT - not main contract!
            amount,
        )
        .freezeWith(client);

    const response = await transaction.execute(client);
    const receipt = await response.getReceipt(client);

    console.log(`Allowance set: ${tokenId} owner=${ownerId} spender=${spenderId}`);
    return receipt.status.toString();
}

// HBAR Allowance (for paying fees via contract)
async function setHbarAllowance(client, ownerId, spenderId, amountHbar) {
    const transaction = new AccountAllowanceApproveTransaction()
        .approveHbarAllowance(ownerId, spenderId, new Hbar(amountHbar))
        .freezeWith(client);

    const response = await transaction.execute(client);
    const receipt = await response.getReceipt(client);

    return receipt.status.toString();
}
```

### Checking Existing Allowances

```javascript
async function checkTokenAllowance(env, ownerId, tokenId) {
    const baseUrl = getBaseURL(env);
    const url = `${baseUrl}/api/v1/accounts/${ownerId}/allowances/tokens`;

    const response = await axios.get(url);

    for (const allowance of response.data.allowances || []) {
        if (allowance.token_id === tokenId.toString()) {
            return {
                spender: allowance.spender,
                amount: allowance.amount,
            };
        }
    }

    return null;
}
```

---

## 7. NFT Transfers with Allowances

### Contract-Side: isApproval Flag

When a contract transfers NFTs on behalf of a user (via allowance), the HTS transfer **must** include `isApproval = true`:

```solidity
// In Solidity contract
nftTransfer.senderAccountID = senderAddress;
nftTransfer.receiverAccountID = receiverAddress;
nftTransfer.serialNumber = int64(serials[i].toInt256());
nftTransfer.isApproval = true;  // CRITICAL: Use approved allowance from sender
```

### Test-Side: Setting NFT Allowances

```javascript
// Set NFT allowance for all serials
const contractAccountId = AccountId.fromString(contractId.toString());
await setNFTAllowanceAll(client, [tokenId], ownerId, contractAccountId);
```

### SDK Version Note

Use SDK v2.78.0+ for full NFT allowance support:
- `deleteTokenNftAllowanceAllSerials` - requires SDK v2.78.0+
- `TokenNftAllowance` improvements - v2.70.0+

---

## 8. Client Setup and Environment

### Standard Client Initialization Pattern

```javascript
const {
    Client,
    AccountId,
    PrivateKey,
} = require('@hashgraph/sdk');
require('dotenv').config();

function initializeClient() {
    const operatorId = AccountId.fromString(process.env.ACCOUNT_ID);
    const operatorKey = PrivateKey.fromStringED25519(process.env.PRIVATE_KEY);
    const env = process.env.ENVIRONMENT || 'testnet';

    const envUpper = env.toUpperCase();
    let client;

    if (envUpper === 'MAINNET' || envUpper === 'MAIN') {
        client = Client.forMainnet();
    }
    else if (envUpper === 'TESTNET' || envUpper === 'TEST') {
        client = Client.forTestnet();
    }
    else if (envUpper === 'PREVIEWNET' || envUpper === 'PREVIEW') {
        client = Client.forPreviewnet();
    }
    else if (envUpper === 'LOCAL') {
        const node = { '127.0.0.1:50211': new AccountId(3) };
        client = Client.forNetwork(node).setMirrorNetwork('127.0.0.1:5600');
    }
    else {
        throw new Error(`Unknown environment: ${env}`);
    }

    client.setOperator(operatorId, operatorKey);

    return { client, operatorId, operatorKey, env };
}
```

### Environment Variable Pattern

```env
# .env file
ENVIRONMENT=testnet
ACCOUNT_ID=0.0.123456
PRIVATE_KEY=302e020100300506032b657004220420...

# Contract addresses
MAIN_CONTRACT_ID=0.0.234567
STORAGE_CONTRACT_ID=0.0.234568

# Token configuration
LAZY_TOKEN_ID=0.0.345678
LAZY_DECIMALS=8
```

### Key Type Detection

Hedera supports both ED25519 and ECDSA keys. Detect by DER prefix:

```javascript
function detectKeyType(privateKeyHex) {
    if (privateKeyHex.startsWith('302e')) {
        return 'ED25519';
    }
    else if (privateKeyHex.startsWith('3030')) {
        return 'ECDSA';
    }
    return 'UNKNOWN';
}

function loadPrivateKey(keyString) {
    const keyType = detectKeyType(keyString);

    if (keyType === 'ED25519') {
        return PrivateKey.fromStringED25519(keyString);
    }
    else if (keyType === 'ECDSA') {
        return PrivateKey.fromStringECDSA(keyString);
    }
    else {
        return PrivateKey.fromStringDer(keyString);
    }
}
```

---

## 9. Ethers.js Integration

Ethers.js works excellently with Hedera for ABI encoding/decoding.

### Creating an Interface

```javascript
const { ethers } = require('ethers');
const fs = require('fs');

// From compiled artifact
const contractJson = JSON.parse(
    fs.readFileSync('./artifacts/contracts/MyContract.sol/MyContract.json')
);
const iface = new ethers.Interface(contractJson.abi);

// From ABI file
const abi = JSON.parse(fs.readFileSync('./abi/MyContract.json'));
const iface = new ethers.Interface(abi);
```

### Encoding Function Calls

```javascript
// Simple encoding
const encoded = iface.encodeFunctionData('transfer', [recipient, amount]);

// With complex parameters
const encoded = iface.encodeFunctionData('createPool', [
    tokenAddress,
    BigInt(1000000),
    true,
    [addr1, addr2],
]);
```

### Decoding Results

```javascript
// Decode function return value
const decoded = iface.decodeFunctionResult('balanceOf', result);
const balance = decoded[0];

// Decode multiple return values
const decoded = iface.decodeFunctionResult('getPoolInfo', result);
const [name, balance, isActive] = decoded;
```

### Parsing Events

```javascript
async function getContractEvents(env, contractId, iface) {
    const baseUrl = getBaseURL(env);
    const url = `${baseUrl}/api/v1/contracts/${contractId}/results/logs?order=desc&limit=100`;

    const response = await axios.get(url);
    const events = [];

    for (const log of response.data.logs) {
        if (log.data === '0x') continue;

        try {
            const event = iface.parseLog({ topics: log.topics, data: log.data });
            events.push({
                name: event.name,
                args: event.args,
                transactionHash: log.transaction_hash,
                blockNumber: log.block_number,
            });
        } catch (e) {
            // Unknown event, skip
        }
    }

    return events;
}
```

### Parsing Errors

```javascript
function parseError(iface, errorData) {
    if (!errorData) {
        return 'Unknown error: no data';
    }

    // Standard revert with string message
    if (errorData.startsWith('0x08c379a0')) {
        const content = `0x${errorData.substring(10)}`;
        const message = ethers.AbiCoder.defaultAbiCoder().decode(['string'], content);
        return `Revert: ${message}`;
    }

    // Panic error (from Solidity compiler)
    if (errorData.startsWith('0x4e487b71')) {
        const content = `0x${errorData.substring(10)}`;
        const code = ethers.AbiCoder.defaultAbiCoder().decode(['uint'], content);

        const panicCodes = {
            0x00: 'Generic compiler panic',
            0x01: 'Assert failed',
            0x11: 'Arithmetic overflow/underflow',
            0x12: 'Division by zero',
            0x21: 'Invalid enum value',
            0x22: 'Storage byte array encoding error',
            0x31: 'pop() on empty array',
            0x32: 'Array index out of bounds',
            0x41: 'Too much memory allocated',
            0x51: 'Called invalid internal function',
        };

        return `Panic: ${panicCodes[Number(code)] || `Unknown code ${code}`}`;
    }

    // Try custom error from contract ABI
    try {
        const parsed = iface.parseError(errorData);
        if (parsed) {
            const args = parsed.args.map(a => a.toString()).join(', ');
            return `${parsed.name}(${args})`;
        }
    } catch (e) {
        // Not a known custom error
    }

    return `Unknown error: ${errorData}`;
}
```

---

## 10. Mirror Node Queries

### Read-Only Contract Calls (Free)

**This is the preferred way to read contract state**:

```javascript
async function readOnlyEVMFromMirrorNode(env, contractId, encodedData, fromAccount) {
    const baseUrl = getBaseURL(env);

    const body = {
        block: 'latest',
        data: encodedData,  // Encoded function call from ethers
        estimate: false,
        from: fromAccount.toSolidityAddress(),
        gas: 300000,
        gasPrice: 100000000,
        to: contractId.toSolidityAddress(),
        value: 0,
    };

    const response = await axios.post(`${baseUrl}/api/v1/contracts/call`, body);
    return response.data?.result;  // Encoded result - decode with ethers
}
```

### Correct Pattern for `readOnlyEVMFromMirrorNode`

**WRONG - Do not do this:**
```javascript
// Passing interface and function name directly - INCORRECT
const result = await readOnlyEVMFromMirrorNode(
    env,
    contractId,
    iface,           // WRONG - interface is not encodedData
    'functionName',
    [params],
);
```

**CORRECT - Encode data first:**
```javascript
// Create a helper function for clean usage
async function readContract(iface, contractId, functionName, params = [], fromId = operatorId) {
    const encodedCommand = iface.encodeFunctionData(functionName, params);
    const result = await readOnlyEVMFromMirrorNode(
        env,
        contractId,
        encodedCommand,  // Pre-encoded data
        fromId,
        false,           // estimate = false for actual call
    );
    const decoded = iface.decodeFunctionResult(functionName, result);
    return decoded.length === 1 ? decoded[0] : decoded;
}

// Usage
const isAdmin = await readContract(iface, contractId, 'isAdmin', [address]);
```

### Mirror Node Entity Resolution

Use `EntityType` enum to specify what type of entity you're querying:

```javascript
const { EntityType } = require('../utils/hederaMirrorHelpers');

// Available types
EntityType.ACCOUNT   // 'accounts'
EntityType.TOKEN     // 'tokens'
EntityType.CONTRACT  // 'contracts'
```

### Getting EVM Address from Hedera ID

```javascript
const { homebrewPopulateAccountEvmAddress, EntityType } = require('../utils/hederaMirrorHelpers');

// With explicit entity type (preferred - faster)
const tokenEvmAddress = await homebrewPopulateAccountEvmAddress(
    env,
    '0.0.12345',
    EntityType.TOKEN
);

const contractEvmAddress = await homebrewPopulateAccountEvmAddress(
    env,
    contractId.toString(),
    EntityType.CONTRACT
);
```

**Why use this instead of `toSolidityAddress()`?**
- Accounts with ECDSA keys have different EVM addresses than their Hedera-derived address
- The mirror node returns the actual EVM address used on the network
- Falls back to `toSolidityAddress()` if mirror node query fails

### Token Details and Royalty Detection

```javascript
const { getTokenDetails, checkTokenHasFallbackRoyalty } = require('../utils/hederaMirrorHelpers');

// Get token details
const tokenInfo = await getTokenDetails(env, tokenId);

// Check for fallback royalties
const royaltyInfo = await checkTokenHasFallbackRoyalty(env, tokenId);

if (royaltyInfo.hasFallback) {
    // NFT has fallback royalties - may need special handling
    await stakeNFTsToTheGrave(tokenAddress, serials);
} else {
    // No fallback royalties - can transfer directly
    await TransferTransaction().addNftTransfer(...).execute(client);
}
```

---

## 11. Contract Interaction Patterns

### Standard Contract Execution

```javascript
const { ContractExecuteTransaction, Hbar } = require('@hashgraph/sdk');

async function executeContract(client, contractId, iface, functionName, params, gas = 300000, payableHbar = 0) {
    const encoded = iface.encodeFunctionData(functionName, params);

    let tx = new ContractExecuteTransaction()
        .setContractId(contractId)
        .setGas(gas)
        .setFunctionParameters(Buffer.from(encoded.slice(2), 'hex'));

    if (payableHbar > 0) {
        tx = tx.setPayableAmount(new Hbar(payableHbar));
    }

    const response = await tx.execute(client);
    const receipt = await response.getReceipt(client);

    if (receipt.status.toString() !== 'SUCCESS') {
        throw new Error(`Transaction failed: ${receipt.status}`);
    }

    return { response, receipt };
}
```

### Query Contract State (Free via Mirror)

```javascript
async function queryContract(env, contractId, iface, functionName, params = []) {
    const encoded = iface.encodeFunctionData(functionName, params);

    const result = await readOnlyEVMFromMirrorNode(
        env,
        contractId,
        encoded,
        AccountId.fromString('0.0.1'),  // Dummy "from" address for queries
    );

    return iface.decodeFunctionResult(functionName, result);
}
```

### Contract Deployment

```javascript
const json = JSON.parse(fs.readFileSync('./artifacts/contracts/Contract.sol/Contract.json'));
const iface = new ethers.Interface(json.abi);
const bytecode = json.bytecode;

const [contractId, contractAddress] = await contractDeployFunction(
    client,
    bytecode,
    6_000_000,  // Gas limit
    new ContractFunctionParameters()
        .addAddress(param1Address)
        .addAddress(param2Address)
);
```

---

## 12. Gas Estimation and Limits

### Contract Size Limit

Hedera enforces the same **24KB** contract size limit as Ethereum.

```javascript
// hardhat.config.js
module.exports = {
    solidity: {
        settings: {
            optimizer: {
                enabled: true,
                runs: 200,  // Lower = smaller bytecode
            },
            viaIR: true,  // Can reduce size for complex contracts
        },
    },
};
```

### Gas Constants

```javascript
const BASE_GAS = 400_000;                  // Standard contract call
const ASSOCIATION_GAS_PER_TOKEN = 950_000; // Extra gas per token association
```

### Using gasHelpers.js

```javascript
const { estimateGas } = require('../utils/gasHelpers');

async function getGasEstimate(iface, contractId, functionName, params = [], fallbackGas = BASE_GAS, valueTinybar = 0) {
    const gasInfo = await estimateGas(
        env,
        contractId,
        iface,
        operatorId,
        functionName,
        params,
        fallbackGas,
        valueTinybar  // Value in tinybars for payable functions
    );
    return gasInfo.gasLimit;
}
```

### Token Association Gas

When a contract associates a token, add 950,000 gas per token:

```javascript
const gasLimit = BASE_GAS + ASSOCIATION_GAS_PER_TOKEN;
// For multiple tokens: BASE_GAS + (ASSOCIATION_GAS_PER_TOKEN * tokenCount)
```

---

## 13. Error Handling

### Expecting Errors - CORRECT Pattern

**WRONG - Do not use try/catch with Hedera SDK:**
```javascript
// This pattern does NOT work correctly
try {
    await contractExecuteFunction(...);
    expect.fail('Should have failed');
} catch (err) {
    expect(err instanceof StatusError).to.be.true;
}
```

**CORRECT - Check result status:**
```javascript
const result = await contractExecuteFunction(
    contractId,
    iface,
    client,
    gasLimit,
    'functionName',
    [params]
);

const status = result[0]?.status;
expect(
    status?.name === 'ExpectedErrorName' ||
    status?.toString().includes('REVERT') ||
    status?.toString() !== 'SUCCESS'
).to.be.true;

console.log('Error caught - status:', status?.name || status?.toString());
```

### Custom Error Names

The `status?.name` property contains the custom error selector name (e.g., `PermissionDenied`, `TooManySerials`, `EmptySerialsArray`).

### Global Error Interfaces

Set up `global.errorInterfaces` for comprehensive error decoding:

```javascript
// Combine ABIs from all contracts
const allAbis = [
    ...mainContractJson.abi,
    ...helperContractJson.abi,
    ...tokenContractJson.abi,
];
global.errorInterfaces = new ethers.Interface(allAbis);
```

---

## 14. Testing Patterns

### Hardhat Configuration for Hedera

```javascript
// hardhat.config.js
module.exports = {
    solidity: {
        version: '0.8.18',
        settings: {
            optimizer: {
                enabled: true,
                runs: 200,
            },
            viaIR: true,
        },
    },
    mocha: {
        timeout: 100000,  // 100 seconds - Hedera operations are slower
        slow: 100000,
    },
    contractSizer: {
        strict: true,  // Fail if any contract exceeds 24KB
    },
};
```

### Test Setup Pattern

```javascript
const { expect } = require('chai');

describe('MyContract', function() {
    let client;
    let operatorId, operatorKey;
    let contractId;
    let testAccounts = [];

    before(async function() {
        operatorId = AccountId.fromString(process.env.ACCOUNT_ID);
        operatorKey = PrivateKey.fromStringED25519(process.env.PRIVATE_KEY);
        client = Client.forTestnet().setOperator(operatorId, operatorKey);

        contractId = await deployContract(client, ...);
    });

    beforeEach(async function() {
        const aliceKey = PrivateKey.generateED25519();
        const aliceId = await accountCreator(client, aliceKey, 100);
        testAccounts.push({ id: aliceId, key: aliceKey });
    });

    after(async function() {
        client.close();
    });
});
```

### Mirror Node Delays in Tests

```javascript
const result = await contractExecuteFunction(...);
expect(result[0]?.status.toString()).to.equal('SUCCESS');
await sleep(4000);  // Wait for mirror node to update

const balance = await checkMirrorBalance(env, address, tokenId);
```

### Test Timeouts

```javascript
describe('Deployment: ', function () {
    it('Should deploy...', async function () {
        this.timeout(900000);  // 15 minutes for testnet
        // ...
    });
});
```

---

## 15. Multi-Signature Considerations

### Transaction Validity Window

Hedera transactions are only valid for **119 seconds** after creation.

```javascript
const HEDERA_TX_VALIDITY = 119;  // seconds
const SAFE_TIMEOUT = 110;        // Leave 9 second buffer

function getRemainingTime(transaction) {
    const validStart = transaction.transactionValidStart;
    const now = Date.now() / 1000;
    const elapsed = now - validStart.seconds;
    return HEDERA_TX_VALIDITY - elapsed;
}
```

### Getting Transaction Records After Multi-Sig

**Problem**: After multi-sig execution, you can't call `getRecord()` without signing again.
**Solution**: Use mirror node (free, no signing required).

```javascript
async function getTransactionResultAfterMultiSig(env, transactionId) {
    await new Promise(resolve => setTimeout(resolve, 5000));

    const mirrorTxId = formatTransactionIdForMirror(transactionId);
    const baseUrl = getBaseURL(env);
    const url = `${baseUrl}/api/v1/transactions/${mirrorTxId}`;

    const response = await axios.get(url);
    return response.data;
}
```

### Freezing Transactions for Multi-Sig

```javascript
async function freezeTransactionForSignatures(client, transaction) {
    const frozenTx = await transaction.freezeWith(client);
    const txBytes = frozenTx.toBytes();

    return {
        frozenTransaction: frozenTx,
        bytes: txBytes,
        transactionId: frozenTx.transactionId.toString(),
    };
}

function signTransactionBytes(txBytes, privateKey) {
    const signature = privateKey.sign(txBytes);
    return {
        publicKey: privateKey.publicKey.toStringRaw(),
        signature: Buffer.from(signature).toString('hex'),
    };
}
```

---

## 16. Account and Address Formats

### Hedera Account ID

```
0.0.123456
 │  │   │
 │  │   └── Entity number
 │  └────── Realm (always 0 for now)
 └───────── Shard (always 0 for now)
```

### Converting Between Formats

```javascript
const { AccountId, ContractId } = require('@hashgraph/sdk');

// Hedera ID to Solidity address
const accountId = AccountId.fromString('0.0.123456');
const evmAddress = accountId.toSolidityAddress();
// Returns: 0x000000000000000000000000000000000001e240

// Solidity address to Hedera ID
const evmAddress = '0x000000000000000000000000000000000001e240';
const accountId = AccountId.fromEvmAddress(0, 0, evmAddress);
// Returns: 0.0.123456

// Same for contracts
const contractId = ContractId.fromString('0.0.234567');
const contractEvmAddress = contractId.toSolidityAddress();
```

### In Solidity Contracts

```solidity
function hederaAccountToAddress(uint64 accountNum) internal pure returns (address) {
    return address(uint160(accountNum));
}
```

---

## 17. PRNG (Random Numbers)

### Hedera PRNG Precompile

```solidity
// Address: 0x169
interface IPrngSystemContract {
    function getPseudorandomSeed() external returns (bytes32);
}

contract MyContract {
    address constant PRNG = address(0x169);

    function getRandomNumber() internal returns (bytes32) {
        (bool success, bytes memory result) = PRNG.call(
            abi.encodeWithSignature("getPseudorandomSeed()")
        );
        require(success, "PRNG call failed");
        return abi.decode(result, (bytes32));
    }
}
```

### Processing PRNG Seeds

```solidity
function getMultipleRandomValues(uint256 count) internal returns (uint256[] memory) {
    bytes32 seed = getRandomNumber();
    uint256[] memory values = new uint256[](count);

    for (uint256 i = 0; i < count; i++) {
        values[i] = uint256(keccak256(abi.encodePacked(seed, i)));
    }

    return values;
}

function randomInRange(bytes32 seed, uint256 nonce, uint256 max) internal pure returns (uint256) {
    return uint256(keccak256(abi.encodePacked(seed, nonce))) % max;
}
```

---

## 18. Common Pitfalls

### Pitfall 1: Forgetting Token Association

```javascript
// WRONG
await transferToken(client, tokenId, sender, recipient, amount);  // FAILS

// CORRECT
await associateTokenToAccount(client, recipient, recipientKey, tokenId);
await transferToken(client, tokenId, sender, recipient, amount);
```

### Pitfall 2: Approving Wrong Contract

```javascript
// WRONG - Approving the main contract
await setFTAllowance(client, tokenId, user, mainContractId, amount);

// CORRECT - Approve the storage contract that calls transferFrom
await setFTAllowance(client, tokenId, user, storageContractId, amount);
```

### Pitfall 3: Querying Mirror Too Soon

```javascript
// WRONG
await executeTransaction(client, tx);
const result = await queryMirrorNode(env, txId);  // May fail!

// CORRECT
await executeTransaction(client, tx);
await new Promise(r => setTimeout(r, 5000));  // Wait 5 seconds
const result = await queryMirrorNode(env, txId);
```

### Pitfall 4: Using Wrong Transaction ID Format

```javascript
// WRONG - SDK format in mirror URL
const url = `${baseUrl}/api/v1/transactions/0.0.123@456.789`;

// CORRECT - Mirror format in mirror URL
const txId = formatTransactionIdForMirror('0.0.123@456.789');
const url = `${baseUrl}/api/v1/transactions/${txId}`;
```

### Pitfall 5: Assuming ERC-20 Compatibility

```javascript
// WRONG
await token.approve(spender, amount);

// CORRECT - Use Hedera SDK
await new AccountAllowanceApproveTransaction()
    .approveTokenAllowance(tokenId, owner, spender, amount)
    .execute(client);
```

### Pitfall 6: Not Checking HTS Response Codes

```solidity
// WRONG - Assuming success
HederaTokenService.transferToken(token, from, to, amount);

// CORRECT - Check response
int responseCode = HederaTokenService.transferToken(token, from, to, amount);
require(responseCode == HederaResponseCodes.SUCCESS, "Transfer failed");
```

### Pitfall 7: Using getRecord() After Multi-Sig

```javascript
// WRONG - Requires signing
const record = await response.getRecord(client);

// CORRECT - Use mirror node (free, no signing)
await new Promise(r => setTimeout(r, 5000));
const result = await queryMirrorNode(env, transactionId);
```

### Pitfall 8: Missing isApproval Flag in NFT Transfers

```solidity
// WRONG - Transfer fails silently
nftTransfer.isApproval = false;

// CORRECT - When using allowances
nftTransfer.isApproval = true;
```

---

## Quick Reference Card

```
┌─────────────────────────────────────────────────────────────────┐
│                    HEDERA QUICK REFERENCE                       │
├─────────────────────────────────────────────────────────────────┤
│ Mirror Node Delay:        5 seconds minimum                     │
│ Transaction Validity:     119 seconds (use 110 for safety)      │
│ Contract Size Limit:      24KB                                  │
│ HTS Precompile:           0x167                                 │
│ PRNG Precompile:          0x169                                 │
├─────────────────────────────────────────────────────────────────┤
│ BEFORE receiving tokens:  Associate first!                      │
│ BEFORE spending tokens:   Approve STORAGE contract!             │
│ BEFORE querying mirror:   Wait 5 seconds!                       │
│ BEFORE multi-sig record:  Use mirror node, not getRecord()!     │
│ NFT allowance transfers:  Set isApproval = true!                │
├─────────────────────────────────────────────────────────────────┤
│ TX ID SDK format:         0.0.123@456.789                       │
│ TX ID Mirror format:      0.0.123-456-789                       │
│ Account to EVM:           accountId.toSolidityAddress()         │
│ EVM to Account:           AccountId.fromEvmAddress(0, 0, addr)  │
├─────────────────────────────────────────────────────────────────┤
│ Gas Constants:                                                  │
│   Base gas:               400,000                               │
│   Token association:      +950,000 per token                    │
├─────────────────────────────────────────────────────────────────┤
│ Mirror URLs:                                                    │
│   Testnet:  https://testnet.mirrornode.hedera.com               │
│   Mainnet:  https://mainnet-public.mirrornode.hedera.com        │
│   Preview:  https://previewnet.mirrornode.hedera.com            │
│   Local:    http://localhost:8000                               │
└─────────────────────────────────────────────────────────────────┘
```

---

## Document Maintenance

- **Last Updated**: 2025-12-30
- **Portability**: Copy to any Hedera project root as `HEDERA_SOLIDITY_GUIDE.md`
- **Target Reader**: Claude (AI assistant)

When copying to a new project:
1. Copy this file to project root
2. Reference in CLAUDE.md: "See HEDERA_SOLIDITY_GUIDE.md for Hedera patterns"
3. Update project-specific details if needed (contract names, storage addresses)

---

*This guide captures lessons learned from real Hedera development. It prioritizes practical patterns over exhaustive documentation.*
