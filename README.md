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