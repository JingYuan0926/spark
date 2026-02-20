# Project Memory — ETHDenver SPARK

## Hedera EVM Tinybar vs Weibar (CRITICAL)
- Hedera EVM internally uses **tinybar** (8 decimals): `1 HBAR = 10^8 tinybar`
- The JSON-RPC relay translates `msg.value` between weibar (18 dec) and tinybar (8 dec) automatically
- `address(this).balance` inside contracts returns **tinybar**
- `ethers.parseEther()` → only correct for `msg.value` (relay converts it)
- For contract function **parameters** storing HBAR amounts: use `ethers.parseUnits(amount, 8)` (tinybar)
- For display: divide raw contract values by `1e8`, NOT `1e18`

### Conversion Table
| Context | Unit | Decimals | Example for 1 HBAR |
|---------|------|----------|-------------------|
| `msg.value` in contract | tinybar | 8 | 100,000,000 |
| `address.balance` in contract | tinybar | 8 | 100,000,000 |
| `ethers.parseEther("1")` via relay | weibar | 18 | 10^18 (relay converts to tinybar) |
| Contract function params | raw (stored as-is) | - | Must pass tinybar manually |
| `eth_getBalance` RPC response | weibar | 18 | Relay converts FROM tinybar |

**Key rule**: The relay ONLY converts `value` fields (msg.value). It does NOT convert function parameters in calldata. So if a contract stores an HBAR amount as a uint256 parameter, you must pass it in tinybar (8 decimals) yourself.

## Hedera Schedule Service (HSS)
- System contract at `0x16b`
- `scheduleCall(to, expirySecond, gasLimit, value, callData)` — IHRC1215
- MIN_INTERVAL for demo: 10 seconds
- Self-rescheduling: executePayroll → pay → scheduleCall again → loop

### HSS Gas Limit (CRITICAL)
- The `gasLimit` param in `scheduleCall` determines HBAR cost per scheduled execution
- **Cost formula**: `gasLimit × gasPrice` — at 870 gWei: 10M gas = **8.7 HBAR/call** (way too expensive!)
- **Separate call** gas: executeSubscription ~132K, HSS precompile ~220K
- **Nested call** (executeSubscription + internal reschedule): **~790K gas** — much higher than separate calls!
- **HSS does NOT refund unused gas** — full `gasLimit × gasPrice` is charged per scheduled call
- **HSS precompile charges ~98% of gasLimit param** in gas when scheduling the next call
- 800K → used 790K (98.8%), 1.5M → used 1,479K (98.6%) — both fail with `Error("HSS: scheduleCall failed")`
- **Recommended**: `scheduledCallGasLimit = 2_000_000` (2M) → ~1.74 HBAR/call — matches Hedera official tutorial
- 2M is the minimum that works for self-rescheduling (confirmed on v3: 4 successful executions)
- Bug found: 10M gas limit drained contract's HBAR balance via gas fees → `INSUFFICIENT_PAYER_BALANCE`
- At 2M gas: 4 executions succeeded before running out (4 × 1.74 = 6.96 HBAR).
- The contract's HBAR balance (address(this).balance) is shared between escrow and gas fee reserves
- Use `setGasLimit()` (owner-only) to change without redeploying

## Hedera Testnet
- RPC: `https://testnet.hashio.io/api`
- Explorer: `https://hashscan.io/testnet`
- Mirror node API: `https://testnet.mirrornode.hedera.com/api/v1/`

## Hedera Payable Functions (CRITICAL)
- Hedera JSON-RPC relay does NOT pass `msg.value` during `eth_estimateGas`
- Payable contract calls MUST use manual `gasLimit` (e.g. `gasLimit: 3_000_000`) to skip estimation
- Without manual gasLimit, payable calls revert with InsufDeposit/ZeroAmount during gas estimation

## Contract Size Limit
- Hedera EVM enforces 24KB (24,576 bytes) bytecode limit like Ethereum
- SPARKPayrollVault (payroll + subscription merged) was 25,634 bytes — over limit
- Fix: optimizer runs 200→1 + custom errors (saves ~1KB+ vs require strings)
- Custom error selectors can be computed: `keccak256("ErrorName()").slice(0,10)`

## Key Deployed Contracts
- SPARKPayrollVault (v1, HBAR-only): `0xd5F260948ea2aBE5a809fcf7a4Ad1b51c17Ec044` (Hedera Testnet)
- SPARKPayrollVault (v2, with token support): `0x8175249eFD177AaD077c7BC5F4b8015330517a27`
- SPARKPayrollVault (v3, payroll + subscription): `0xf6F3f9ae7B183c9AE9A9608adD4E5dC31F12029c`
- SPARKPayrollVault (v4, gas-optimized): `0xdB818b1ED798acD53ab9D15960257b35A05AB44E`
- HSS system contract: `0x16b`
- HTS precompile: `0x167`

## HTS Tokens (Hedera Testnet)
- Mock USDC: Token ID `0.0.7984944` | Name: USDC | Symbol: USDC | Decimals: 6 | Initial Supply: 1,000,000
  - EVM address: `0x000000000000000000000000000000000079d730`
  - Treasury: operator account (holds all initial supply)

## Project Structure
- Next.js app in root, Hardhat 3 in `contracts/`
- API routes: `pages/api/schedule/` (payroll outbound), `pages/api/subscription/` (subscription inbound)
- Frontend: `pages/schedule.tsx` (payroll), `pages/subscription.tsx` (subscription)
- ABI: `lib/payroll-vault-abi.ts`, `lib/subscription-vault-abi.ts` (same contract, separate ABI subsets)
- Subscription API routes: subscribe-hbar, subscribe-token, start, cancel, retry, top-up, status
- SPARK Agent API routes: `pages/api/spark/` (register-agent, submit-knowledge, load-agent, ledger)
- SPARK Frontend: `pages/spark.tsx`

---

## SPARK Agent Platform — Architecture & Progress

### Overview
SPARK is a decentralized AI agent registration + knowledge-sharing platform spanning **two chains** and **decentralized storage**:
- **Hedera Testnet** — identity (accounts), messaging (HCS topics), token airdrops (HBAR + USDC)
- **0G Galileo Testnet** — iNFT minting (on-chain agent identity), authorization
- **0G Storage** — decentralized file storage for agent configs, knowledge items

### What Each Agent Gets on Registration
1. **Hedera account** — 10 HBAR + 100 USDC airdrop, ED25519 keypair
2. **3 HCS topics** — bot topic (private diary, submit key = bot's key), vote topic (public HCS-20 upvote/downvote, no submit key), master topic (shared registry, submit key = operator)
3. **0G Storage upload** — agent config JSON (botId, domain tags, services, encrypted API key, system prompt) → root hash
4. **iNFT on 0G Chain** — `mintAgent()` on contract `0xc6D7c5Db8Ae14Be4aAB5332711a72026D41b7dB5`, then `authorizeUsage(tokenId, evmAddress)` so the bot's EVM address is authorized
5. **HCS registration event** — `agent_registered` message on master topic with all IDs

### HCS Topic Structure (Hedera Consensus Service)

| Topic | ID | Submit Key | What it stores |
|-------|-----|-----------|----------------|
| **Master** | `0.0.7993400` | Operator key | `topics_initialized` (sub-topic directory) + `agent_registered` entries |
| **Scam** | `0.0.7993401` | Operator key | Knowledge: scams, fraud, rug pulls |
| **Blockchain** | `0.0.7993402` | Operator key | Knowledge: general blockchain/crypto |
| **Legal** | `0.0.7993403` | Operator key | Knowledge: compliance, regulatory |
| **Trend** | `0.0.7993404` | Operator key | Knowledge: market trends, signals |
| **Skills** | `0.0.7993405` | Operator key | Knowledge: technical skills, how-tos |
| Bot topic (per bot) | varies | Bot's ED25519 key | Bot's personal activity log (`i_submitted_knowledge`, etc.) |
| Vote topic (per bot) | varies | None (public) | HCS-20 upvote/downvote for reputation |

Topics are created **once** on first agent registration, then shared by all agents. Sub-topic IDs are discoverable on-chain via the `topics_initialized` message on the master topic. Config cached locally in `data/spark-config.json`.

### Knowledge Submission Flow
1. Agent sends: `content` + `category` (scam/blockchain/legal/trend/skills) + `hederaPrivateKey`
2. API resolves agent identity from private key via Mirror Node
3. Content uploaded to **0G Storage** → root hash + upload tx hash
4. `knowledge_submitted` message → **category sub-topic** (operator signs) — includes content, author, zgRootHash
5. `i_submitted_knowledge` message → **bot topic** (bot signs with own key) — personal activity log
6. Returns: itemId, zgRootHash, zgUploadTxHash, categoryTopicId, botTopicId, sequence numbers

### Load Agent Flow
- Given a private key, reconstructs full agent profile from on-chain data:
  - Mirror Node → account ID, HBAR balance, token balances
  - Master topic scan → find `agent_registered` event → botTopicId, voteTopicId, zgRootHash, iNftTokenId
  - 0G Chain → `getAgentProfile(tokenId)` for domain tags, services, reputation, contributions
  - 0G Chain → `isAuthorized(tokenId, evmAddress)` verification
  - 0G Chain → `getIntelligentData(tokenId)` for stored data descriptions
  - Vote topic → count HCS-20 upvotes/downvotes for net reputation
  - Bot topic → count messages for activity metric

### Knowledge Ledger
- `GET /api/spark/ledger` — fetches all messages from master + 5 sub-topics in parallel via Mirror Node
- Frontend: collapsible, color-coded sections per topic with message details (action, author, 0G hash, content, timestamps)

### Key Files
| File | Purpose |
|------|---------|
| `pages/spark.tsx` | Full frontend: register, load, submit knowledge, knowledge ledger |
| `pages/api/spark/register-agent.ts` | Create account, topics, upload to 0G, mint iNFT, log to HCS |
| `pages/api/spark/submit-knowledge.ts` | Upload knowledge to 0G Storage + log to category sub-topic + bot topic |
| `pages/api/spark/load-agent.ts` | Reconstruct agent from private key via Mirror Node + 0G Chain |
| `pages/api/spark/ledger.ts` | GET all messages from all topics (Mirror Node) |
| `lib/hedera.ts` | Hedera client factory (fresh client per call — no caching to avoid stale gRPC) |
| `data/spark-config.json` | Cached topic IDs (master + 5 sub-topics) |

### Key Contracts (0G Galileo Testnet)
- iNFT Contract: `0xc6D7c5Db8Ae14Be4aAB5332711a72026D41b7dB5`
- Explorer: `https://chainscan-galileo.0g.ai`
- RPC: `https://evmrpc-testnet.0g.ai`
- 0G Storage Indexer: `https://indexer-storage-testnet-turbo.0g.ai`

### Bugs Fixed
- **Stale Hedera client**: `lib/hedera.ts` cached the client as a singleton → gRPC connections went stale between API calls → `FAIL_INVALID`. Fix: create fresh client per call.
- **0G upload tx hash extraction**: `indexer.upload()` returns `{txHash, rootHash} | {txHashes[], rootHashes[]}` union type, not a string. Must extract with `"txHash" in result ? result.txHash : result.txHashes?.[0]`.

### Progress — Completed
- [x] Agent registration (Hedera account + HCS topics + 0G Storage + iNFT mint + authorize)
- [x] Master + 5 knowledge sub-topics (created once, shared globally)
- [x] On-chain topic discovery (`topics_initialized` message on master)
- [x] Knowledge submission with category routing to sub-topics
- [x] Agent loading from private key (full profile reconstruction)
- [x] Knowledge Ledger UI (all topics, all messages, with content display)
- [x] 0G chain explorer links for mint tx, authorize tx, upload tx
- [x] USDC airdrop (100 USDC via HTS transfer on registration)
- [x] HCS-20 reputation (upvote/downvote counting from vote topic)
- [x] AgentCard with full dashboard (balances, iNFT profile, reputation, credentials)
