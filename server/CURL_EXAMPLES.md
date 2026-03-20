# SPARK Server — cURL Examples

Base URL: `http://localhost:4000`

## Setup
```bash
cd server && npm install && npm start
```

---

## Health / Route Index
```bash
curl http://localhost:4000/
```

---

## Encrypt / Decrypt

```bash
# Encrypt
curl -X POST http://localhost:4000/encrypt \
  -H "Content-Type: application/json" \
  -d '{"plaintext": "hello world"}'

# Decrypt
curl -X POST http://localhost:4000/decrypt \
  -H "Content-Type: application/json" \
  -d '{"encrypted": "<base64 from encrypt>"}'
```

---

## Hedera

```bash
# Create Account
curl -X POST http://localhost:4000/hedera/create-account

# Get Balance
curl -X POST http://localhost:4000/hedera/balance \
  -H "Content-Type: application/json" \
  -d '{"accountId": "0.0.1234"}'

# Create Topic
curl -X POST http://localhost:4000/hedera/create-topic

# Submit Message
curl -X POST http://localhost:4000/hedera/submit-message \
  -H "Content-Type: application/json" \
  -d '{"topicId": "0.0.1234", "message": "hello"}'

# Create Fungible Token
curl -X POST http://localhost:4000/hedera/create-token \
  -H "Content-Type: application/json" \
  -d '{"name": "Mock USDC", "symbol": "USDC", "decimals": 6, "initialSupply": 1000000}'

# Create NFT
curl -X POST http://localhost:4000/hedera/create-nft

# Associate Token
curl -X POST http://localhost:4000/hedera/associate-token \
  -H "Content-Type: application/json" \
  -d '{"tokenId": "0.0.1234", "accountId": "0.0.5678", "privateKey": "302e..."}'

# Transfer Token
curl -X POST http://localhost:4000/hedera/transfer-token \
  -H "Content-Type: application/json" \
  -d '{"tokenId": "0.0.1234", "receiverAccountId": "0.0.5678", "amount": 100}'

# HCS-20 Deploy
curl -X POST http://localhost:4000/hedera/hcs20 \
  -H "Content-Type: application/json" \
  -d '{"topicId": "0.0.1234", "op": "deploy", "tick": "SPARK", "name": "SPARK", "max": "999999"}'

# HCS-20 Mint
curl -X POST http://localhost:4000/hedera/hcs20 \
  -H "Content-Type: application/json" \
  -d '{"topicId": "0.0.1234", "op": "mint", "tick": "SPARK", "amt": "100", "to": "0.0.5678"}'

# HCS-20 Transfer
curl -X POST http://localhost:4000/hedera/hcs20 \
  -H "Content-Type: application/json" \
  -d '{"topicId": "0.0.1234", "op": "transfer", "tick": "SPARK", "amt": "50", "from": "0.0.5678", "to": "0.0.9999"}'

# HCS-20 Burn
curl -X POST http://localhost:4000/hedera/hcs20 \
  -H "Content-Type: application/json" \
  -d '{"topicId": "0.0.1234", "op": "burn", "tick": "SPARK", "amt": "10", "from": "0.0.5678"}'

# AI Vote Setup (create topic + deploy tickers)
curl -X POST http://localhost:4000/hedera/ai-vote \
  -H "Content-Type: application/json" \
  -d '{"action": "setup"}'

# AI Vote Cast
curl -X POST http://localhost:4000/hedera/ai-vote \
  -H "Content-Type: application/json" \
  -d '{"action": "vote", "topicId": "0.0.1234", "agentAccountId": "0.0.5678", "agentPrivateKey": "302e...", "target": "0.0.9999", "vote": "up"}'
```

---

## 0G Compute

```bash
# List Inference Services
curl -X POST http://localhost:4000/compute/list-services

# List Fine-Tuning Services
curl -X POST http://localhost:4000/compute/ft-list-services

# List Fine-Tuning Models
curl -X POST http://localhost:4000/compute/ft-list-models

# Run Inference
curl -X POST http://localhost:4000/compute/inference \
  -H "Content-Type: application/json" \
  -d '{"provider": "0x...", "message": "What is 0G?"}'

# Setup Account (create ledger)
curl -X POST http://localhost:4000/compute/setup-account \
  -H "Content-Type: application/json" \
  -d '{"action": "create-ledger", "amount": 0.1}'

# Deposit to Ledger
curl -X POST http://localhost:4000/compute/setup-account \
  -H "Content-Type: application/json" \
  -d '{"action": "deposit", "amount": 0.5}'

# Transfer to Provider
curl -X POST http://localhost:4000/compute/setup-account \
  -H "Content-Type: application/json" \
  -d '{"action": "transfer", "provider": "0x...", "amount": 0.1}'

# Get Balance
curl -X POST http://localhost:4000/compute/setup-account \
  -H "Content-Type: application/json" \
  -d '{"action": "get-balance"}'

# Create Fine-Tuning Task
curl -X POST http://localhost:4000/compute/ft-create-task \
  -H "Content-Type: application/json" \
  -d '{"provider": "0x...", "model": "model-name", "dataset": [{"instruction":"test","input":"hello","output":"world"}]}'

# Get Fine-Tuning Task
curl -X POST http://localhost:4000/compute/ft-get-task \
  -H "Content-Type: application/json" \
  -d '{"provider": "0x...", "taskId": "task-123"}'

# List Fine-Tuning Tasks
curl -X POST http://localhost:4000/compute/ft-get-task \
  -H "Content-Type: application/json" \
  -d '{"provider": "0x...", "action": "list"}'
```

---

## Payroll Schedule

```bash
# Get Full Vault Status
curl -X POST http://localhost:4000/schedule/status

# Add Agent
curl -X POST http://localhost:4000/schedule/add-agent \
  -H "Content-Type: application/json" \
  -d '{"agent": "0x...", "name": "Agent-1", "amountPerPeriod": "0.5", "intervalSeconds": 3600}'

# Update Agent
curl -X POST http://localhost:4000/schedule/update-agent \
  -H "Content-Type: application/json" \
  -d '{"agentIdx": 0, "amountPerPeriod": "1.0", "intervalSeconds": 7200}'

# Remove Agent
curl -X POST http://localhost:4000/schedule/remove-agent \
  -H "Content-Type: application/json" \
  -d '{"agentIdx": 0}'

# Start Payroll
curl -X POST http://localhost:4000/schedule/start-payroll \
  -H "Content-Type: application/json" \
  -d '{"agentIdx": 0}'

# Cancel Payroll
curl -X POST http://localhost:4000/schedule/cancel-payroll \
  -H "Content-Type: application/json" \
  -d '{"agentIdx": 0}'

# Retry Payroll
curl -X POST http://localhost:4000/schedule/retry-payroll \
  -H "Content-Type: application/json" \
  -d '{"agentIdx": 0}'

# Fund Vault (HBAR)
curl -X POST http://localhost:4000/schedule/fund \
  -H "Content-Type: application/json" \
  -d '{"amount": "10"}'

# Fund Vault (Token)
curl -X POST http://localhost:4000/schedule/fund-token \
  -H "Content-Type: application/json" \
  -d '{"amount": "1000"}'

# Set Defaults
curl -X POST http://localhost:4000/schedule/set-defaults \
  -H "Content-Type: application/json" \
  -d '{"defaultAmountHbar": "1", "defaultInterval": 3600}'

# Set Payment Token
curl -X POST http://localhost:4000/schedule/set-token \
  -H "Content-Type: application/json" \
  -d '{"tokenAddress": "0x..."}'
```

---

## Subscriptions

```bash
# Get Subscription Status
curl http://localhost:4000/subscription/status

# Subscribe HBAR
curl -X POST http://localhost:4000/subscription/subscribe-hbar \
  -H "Content-Type: application/json" \
  -d '{"name": "My Sub", "amountPerPeriod": "1", "intervalSeconds": 3600, "deposit": "5"}'

# Subscribe Token
curl -X POST http://localhost:4000/subscription/subscribe-token \
  -H "Content-Type: application/json" \
  -d '{"token": "0x...", "name": "USDC Sub", "amountPerPeriod": "10", "intervalSeconds": 86400}'

# Top Up HBAR Subscription
curl -X POST http://localhost:4000/subscription/top-up \
  -H "Content-Type: application/json" \
  -d '{"subIdx": 0, "amount": "5"}'

# Start Subscription
curl -X POST http://localhost:4000/subscription/start \
  -H "Content-Type: application/json" \
  -d '{"subIdx": 0}'

# Cancel Subscription
curl -X POST http://localhost:4000/subscription/cancel \
  -H "Content-Type: application/json" \
  -d '{"subIdx": 0}'

# Retry Subscription
curl -X POST http://localhost:4000/subscription/retry \
  -H "Content-Type: application/json" \
  -d '{"subIdx": 0}'

# Set Gas Limit
curl -X POST http://localhost:4000/subscription/set-gas-limit \
  -H "Content-Type: application/json" \
  -d '{"gasLimit": 500000}'

# Associate Token with Vault
curl -X POST http://localhost:4000/subscription/associate-token \
  -H "Content-Type: application/json" \
  -d '{"token": "0x..."}'

# Approve Token Spending
curl -X POST http://localhost:4000/subscription/approve-token \
  -H "Content-Type: application/json" \
  -d '{"token": "0x...", "amount": "100"}'
```

---

## Utility

```bash
# CSS class name joiner
curl -X POST http://localhost:4000/utils/cn \
  -H "Content-Type: application/json" \
  -d '{"classes": ["btn", "btn-primary", null, false, "active"]}'
```
