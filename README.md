Token Graveyard Solidity using HTS deployed on Hedera

Check-out the repo:

### install dependencies ###
npm install

### Setup .env file ###
ENVIRONMENT=TEST
CONTRACT_NAME=LegacyNoRoyaltyB2E
EVENT_NAME=Burn2EarnEvent
ACCOUNT_ID=
PRIVATE_KEY=

### launch unit tests - please use testnet details ###
npm run test-b2elegacy

## works but not at full functionality
npm run test-b2e


# WITH FALLBACK
This use case is trickier as you have to execute NFT staking and have the allowances set right

User needs an allowance for the NFT to SC
Treasury has to have a $LAZY allowance to the SC

Flow:
 - EOA -> SC [old token]
 - SC -> Treasury [old token]
 - SC- > EOA [new token]

All atomic. Remember to have the LGS configured with this contract as a Contract User (even if not paying out $LAZY) as FT needed for staking.