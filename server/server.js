/**
 * SPARK Standalone Express Server
 * Exposes all lib functions as curlable REST endpoints.
 *
 * Usage:
 *   cd server && npm install && npm start
 *   Server runs on http://localhost:4000
 */

require("dotenv").config({ path: require("path").resolve(__dirname, "../.env.local") });

const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const { ethers } = require("ethers");

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 4000;

// ─────────────────────────────────────────────
// Helpers from lib/encrypt.ts
// ─────────────────────────────────────────────
const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
const TAG_LENGTH = 16;

function deriveKey() {
  const secret = process.env.ZG_STORAGE_PRIVATE_KEY;
  if (!secret) throw new Error("ZG_STORAGE_PRIVATE_KEY not set");
  return crypto.createHash("sha256").update(secret).digest();
}

function encrypt(plaintext) {
  const key = deriveKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf-8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString("base64");
}

function decrypt(encryptedBase64) {
  const key = deriveKey();
  const packed = Buffer.from(encryptedBase64, "base64");
  const iv = packed.subarray(0, IV_LENGTH);
  const tag = packed.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const ciphertext = packed.subarray(IV_LENGTH + TAG_LENGTH);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf-8");
}

// ─────────────────────────────────────────────
// Helpers from lib/hedera.ts
// ─────────────────────────────────────────────
let hederaSdk;
try {
  hederaSdk = require("@hashgraph/sdk");
} catch {
  console.warn("@hashgraph/sdk not installed — Hedera routes will fail");
}

function getHederaClient() {
  const { Client, AccountId, PrivateKey } = hederaSdk;
  const operatorId = process.env.HEDERA_OPERATOR_ID;
  const operatorKey = process.env.HEDERA_OPERATOR_KEY;
  if (!operatorId || !operatorKey) throw new Error("Missing HEDERA_OPERATOR_ID or HEDERA_OPERATOR_KEY");
  const client = Client.forTestnet();
  client.setOperator(AccountId.fromString(operatorId), PrivateKey.fromStringDer(operatorKey));
  return client;
}

function getOperatorId() {
  const id = process.env.HEDERA_OPERATOR_ID;
  if (!id) throw new Error("Missing HEDERA_OPERATOR_ID");
  return id;
}

function getOperatorKey() {
  const key = process.env.HEDERA_OPERATOR_KEY;
  if (!key) throw new Error("Missing HEDERA_OPERATOR_KEY");
  return hederaSdk.PrivateKey.fromStringDer(key);
}

// ─────────────────────────────────────────────
// Helpers from lib/0g-compute.ts
// ─────────────────────────────────────────────
let brokerPromise = null;

function getComputeBroker() {
  if (brokerPromise) return brokerPromise;
  const privateKey = process.env.ZG_STORAGE_PRIVATE_KEY;
  if (!privateKey) throw new Error("Missing ZG_STORAGE_PRIVATE_KEY");
  const ZG_RPC = "https://evmrpc-testnet.0g.ai";
  const provider = new ethers.JsonRpcProvider(ZG_RPC);
  const wallet = new ethers.Wallet(privateKey, provider);
  try {
    const { createZGComputeNetworkBroker } = require("@0glabs/0g-serving-broker");
    brokerPromise = createZGComputeNetworkBroker(wallet);
  } catch {
    console.warn("@0glabs/0g-serving-broker not installed — compute routes will fail");
  }
  return brokerPromise;
}

// ─────────────────────────────────────────────
// Contract ABIs / addresses from lib/*-abi.ts
// ─────────────────────────────────────────────
const PAYROLL_VAULT_ADDRESS = "0xdB818b1ED798acD53ab9D15960257b35A05AB44E";
const SPARKINFT_ADDRESS = "0xc6D7c5Db8Ae14Be4aAB5332711a72026D41b7dB5";
const HEDERA_RPC_URL = "https://testnet.hashio.io/api";
const ZG_RPC = "https://evmrpc-testnet.0g.ai";

// Minimal ABIs for common read functions (full ABIs are very large)
// We import them inline where needed

// ─────────────────────────────────────────────
// Utility: cn (from lib/utils.ts) — trivial, included for completeness
// ─────────────────────────────────────────────
function cn(...classes) {
  return classes.filter(Boolean).join(" ");
}

// ─────────────────────────────────────────────
// Error handler wrapper
// ─────────────────────────────────────────────
function wrap(fn) {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message || "Internal server error" });
    }
  };
}

// ═══════════════════════════════════════════════
// ENCRYPT ROUTES
// ═══════════════════════════════════════════════

// POST /encrypt   { plaintext: "hello" }
app.post("/encrypt", wrap(async (req, res) => {
  const { plaintext } = req.body;
  if (!plaintext) return res.status(400).json({ error: "plaintext is required" });
  res.json({ encrypted: encrypt(plaintext) });
}));

// POST /decrypt   { encrypted: "base64string" }
app.post("/decrypt", wrap(async (req, res) => {
  const { encrypted: enc } = req.body;
  if (!enc) return res.status(400).json({ error: "encrypted is required" });
  res.json({ decrypted: decrypt(enc) });
}));

// ═══════════════════════════════════════════════
// HEDERA ROUTES
// ═══════════════════════════════════════════════

// POST /hedera/create-account
app.post("/hedera/create-account", wrap(async (req, res) => {
  const { AccountCreateTransaction, Hbar, PrivateKey } = hederaSdk;
  const client = getHederaClient();
  const newKey = PrivateKey.generateED25519();
  const tx = await new AccountCreateTransaction()
    .setKey(newKey.publicKey)
    .setInitialBalance(new Hbar(10))
    .setMaxAutomaticTokenAssociations(10)
    .execute(client);
  const receipt = await tx.getReceipt(client);
  res.json({
    accountId: receipt.accountId.toString(),
    evmAddress: newKey.publicKey.toEvmAddress(),
    publicKey: newKey.publicKey.toString(),
    privateKey: newKey.toString(),
  });
}));

// POST /hedera/balance   { accountId: "0.0.1234" }
app.post("/hedera/balance", wrap(async (req, res) => {
  const { AccountBalanceQuery } = hederaSdk;
  const { accountId } = req.body;
  if (!accountId) return res.status(400).json({ error: "accountId is required" });
  const client = getHederaClient();
  const balance = await new AccountBalanceQuery().setAccountId(accountId).execute(client);
  res.json({
    hbar: balance.hbars.toString(),
    tokens: Object.fromEntries([...balance.tokens._map].map(([k, v]) => [k.toString(), v.toString()])),
  });
}));

// POST /hedera/create-topic
app.post("/hedera/create-topic", wrap(async (req, res) => {
  const { TopicCreateTransaction } = hederaSdk;
  const client = getHederaClient();
  const tx = await new TopicCreateTransaction().setTopicMemo("SPARK ETHDenver Demo Topic").execute(client);
  const receipt = await tx.getReceipt(client);
  res.json({ topicId: receipt.topicId.toString() });
}));

// POST /hedera/submit-message   { topicId: "0.0.xxx", message: "hello" }
app.post("/hedera/submit-message", wrap(async (req, res) => {
  const { TopicMessageSubmitTransaction } = hederaSdk;
  const { topicId, message } = req.body;
  if (!topicId || !message) return res.status(400).json({ error: "topicId and message are required" });
  const client = getHederaClient();
  const tx = await new TopicMessageSubmitTransaction().setTopicId(topicId).setMessage(message).execute(client);
  const receipt = await tx.getReceipt(client);
  res.json({ status: receipt.status.toString(), sequenceNumber: receipt.topicSequenceNumber?.toString() });
}));

// POST /hedera/create-token   { name?, symbol?, decimals?, initialSupply? }
app.post("/hedera/create-token", wrap(async (req, res) => {
  const { TokenCreateTransaction, TokenType, TokenSupplyType, Hbar } = hederaSdk;
  const { name = "Mock USDC", symbol = "USDC", decimals = 6, initialSupply = 1000000 } = req.body;
  const client = getHederaClient();
  const operatorKey = getOperatorKey();
  const tx = await new TokenCreateTransaction()
    .setTokenName(name)
    .setTokenSymbol(symbol)
    .setDecimals(Number(decimals))
    .setInitialSupply(Number(initialSupply))
    .setTokenType(TokenType.FungibleCommon)
    .setSupplyType(TokenSupplyType.Infinite)
    .setTreasuryAccountId(getOperatorId())
    .setAdminKey(operatorKey)
    .setSupplyKey(operatorKey)
    .setMaxTransactionFee(new Hbar(30))
    .execute(client);
  const receipt = await tx.getReceipt(client);
  res.json({ tokenId: receipt.tokenId.toString() });
}));

// POST /hedera/create-nft
app.post("/hedera/create-nft", wrap(async (req, res) => {
  const { TokenCreateTransaction, TokenType, TokenSupplyType, TokenMintTransaction, Hbar } = hederaSdk;
  const client = getHederaClient();
  const operatorKey = getOperatorKey();
  const createTx = await new TokenCreateTransaction()
    .setTokenName("SPARK Demo NFT")
    .setTokenSymbol("SPNFT")
    .setTokenType(TokenType.NonFungibleUnique)
    .setSupplyType(TokenSupplyType.Finite)
    .setMaxSupply(100)
    .setTreasuryAccountId(getOperatorId())
    .setAdminKey(operatorKey)
    .setSupplyKey(operatorKey)
    .setMaxTransactionFee(new Hbar(30))
    .execute(client);
  const createReceipt = await createTx.getReceipt(client);
  const tokenId = createReceipt.tokenId;
  const mintTx = await new TokenMintTransaction()
    .setTokenId(tokenId)
    .addMetadata(Buffer.from("SPARK Demo NFT #1"))
    .execute(client);
  const mintReceipt = await mintTx.getReceipt(client);
  res.json({ tokenId: tokenId.toString(), serials: mintReceipt.serials.map((s) => s.toString()) });
}));

// POST /hedera/associate-token   { tokenId, accountId, privateKey }
app.post("/hedera/associate-token", wrap(async (req, res) => {
  const { TokenAssociateTransaction, PrivateKey } = hederaSdk;
  const { tokenId, accountId, privateKey } = req.body;
  if (!tokenId || !accountId || !privateKey) return res.status(400).json({ error: "tokenId, accountId, and privateKey are required" });
  const client = getHederaClient();
  const key = PrivateKey.fromStringDer(privateKey);
  const tx = await new TokenAssociateTransaction()
    .setAccountId(accountId)
    .setTokenIds([tokenId])
    .freezeWith(client)
    .sign(key);
  const result = await tx.execute(client);
  const receipt = await result.getReceipt(client);
  res.json({ status: receipt.status.toString() });
}));

// POST /hedera/transfer-token   { tokenId, receiverAccountId, amount }
app.post("/hedera/transfer-token", wrap(async (req, res) => {
  const { TransferTransaction } = hederaSdk;
  const { tokenId, receiverAccountId, amount } = req.body;
  if (!tokenId || !receiverAccountId || !amount) return res.status(400).json({ error: "tokenId, receiverAccountId, and amount are required" });
  const client = getHederaClient();
  const tx = await new TransferTransaction()
    .addTokenTransfer(tokenId, getOperatorId(), -Number(amount))
    .addTokenTransfer(tokenId, receiverAccountId, Number(amount))
    .execute(client);
  const receipt = await tx.getReceipt(client);
  res.json({ status: receipt.status.toString() });
}));

// POST /hedera/hcs20   { topicId, op, tick, ... }
app.post("/hedera/hcs20", wrap(async (req, res) => {
  const { TopicMessageSubmitTransaction } = hederaSdk;
  const { topicId, op, tick, name, max, amt, to, from, lim, m } = req.body;
  if (!topicId || !op || !tick) return res.status(400).json({ error: "topicId, op, and tick are required" });
  let payload = { p: "hcs-20", op, tick };
  if (op === "deploy") { payload.name = name; payload.max = max; if (lim) payload.lim = lim; }
  if (op === "mint") { payload.amt = amt; payload.to = to; }
  if (op === "transfer") { payload.amt = amt; payload.to = to; payload.from = from; }
  if (op === "burn") { payload.amt = amt; payload.from = from; }
  if (m) payload.m = m;
  const client = getHederaClient();
  const tx = await new TopicMessageSubmitTransaction()
    .setTopicId(topicId)
    .setMessage(JSON.stringify(payload))
    .execute(client);
  const receipt = await tx.getReceipt(client);
  res.json({ status: receipt.status.toString(), sequenceNumber: receipt.topicSequenceNumber?.toString(), payload });
}));

// POST /hedera/ai-vote   { action: "setup"|"vote", topicId?, agentAccountId?, agentPrivateKey?, target?, vote? }
app.post("/hedera/ai-vote", wrap(async (req, res) => {
  const { TopicCreateTransaction, TopicMessageSubmitTransaction, PrivateKey } = hederaSdk;
  const { action } = req.body;
  if (action === "setup") {
    const client = getHederaClient();
    const tx = await new TopicCreateTransaction().setTopicMemo("SPARK AI Vote Topic").execute(client);
    const receipt = await tx.getReceipt(client);
    const topicId = receipt.topicId.toString();
    // Deploy upvote and downvote tickers
    for (const tick of ["UPVOTE", "DOWNVOTE"]) {
      const deployTx = await new TopicMessageSubmitTransaction()
        .setTopicId(topicId)
        .setMessage(JSON.stringify({ p: "hcs-20", op: "deploy", name: tick, tick, max: "999999999" }))
        .execute(client);
      await deployTx.getReceipt(client);
    }
    res.json({ topicId });
  } else if (action === "vote") {
    const { topicId, agentAccountId, agentPrivateKey, target, vote } = req.body;
    if (!topicId || !agentAccountId || !agentPrivateKey || !target || !vote) {
      return res.status(400).json({ error: "topicId, agentAccountId, agentPrivateKey, target, and vote are required" });
    }
    const client = getHederaClient();
    const key = PrivateKey.fromStringDer(agentPrivateKey);
    const tick = vote === "up" ? "UPVOTE" : "DOWNVOTE";
    const payload = JSON.stringify({ p: "hcs-20", op: "mint", tick, amt: "1", to: target, m: `vote by ${agentAccountId}` });
    const tx = await new TopicMessageSubmitTransaction()
      .setTopicId(topicId)
      .setMessage(payload)
      .freezeWith(client)
      .sign(key);
    const result = await tx.execute(client);
    const receipt = await result.getReceipt(client);
    res.json({ status: receipt.status.toString(), tick, target });
  } else {
    res.status(400).json({ error: "action must be 'setup' or 'vote'" });
  }
}));

// ═══════════════════════════════════════════════
// 0G COMPUTE ROUTES
// ═══════════════════════════════════════════════

// POST /compute/list-services
app.post("/compute/list-services", wrap(async (req, res) => {
  const broker = await getComputeBroker();
  const services = await broker.inference.listService();
  res.json({ services });
}));

// POST /compute/ft-list-services
app.post("/compute/ft-list-services", wrap(async (req, res) => {
  const broker = await getComputeBroker();
  const services = await broker.fineTuning.listService();
  res.json({ services });
}));

// POST /compute/ft-list-models
app.post("/compute/ft-list-models", wrap(async (req, res) => {
  const broker = await getComputeBroker();
  const models = await broker.fineTuning.listModel();
  res.json({ models });
}));

// POST /compute/inference   { provider, message }
app.post("/compute/inference", wrap(async (req, res) => {
  const { provider, message } = req.body;
  if (!provider || !message) return res.status(400).json({ error: "provider and message are required" });
  const broker = await getComputeBroker();
  const services = await broker.inference.listService();
  const svc = services.find((s) => s.provider === provider);
  if (!svc) return res.status(404).json({ error: `Provider ${provider} not found` });
  // Acknowledge signer if needed
  try { await broker.inference.acknowledgeProviderSigner(provider); } catch {}
  const headers = await broker.inference.getRequestHeaders(provider, message);
  const axios = require("axios");
  const response = await axios.post(svc.url + "/v1/chat/completions", {
    model: svc.model,
    messages: [{ role: "user", content: message }],
  }, { headers });
  await broker.inference.processResponse(provider, response.data.choices[0].message.content, response.headers);
  res.json({ response: response.data });
}));

// POST /compute/setup-account   { action: "create-ledger"|"deposit"|"transfer"|"get-balance", amount?, provider?, service? }
app.post("/compute/setup-account", wrap(async (req, res) => {
  const { action, amount, provider, service = "inference" } = req.body;
  if (!action) return res.status(400).json({ error: "action is required" });
  const broker = await getComputeBroker();
  const svcBroker = service === "fine-tuning" ? broker.fineTuning : broker.inference;
  if (action === "create-ledger") {
    await svcBroker.addOrUpdateLedger(amount || 0.1);
    res.json({ ok: true, message: "Ledger created/updated" });
  } else if (action === "deposit") {
    await svcBroker.addOrUpdateLedger(amount || 0.1);
    res.json({ ok: true, message: "Deposit successful" });
  } else if (action === "transfer") {
    if (!provider) return res.status(400).json({ error: "provider is required for transfer" });
    await svcBroker.transferLedger(provider, amount || 0.1);
    res.json({ ok: true, message: `Transferred ${amount || 0.1} to ${provider}` });
  } else if (action === "get-balance") {
    const balance = await svcBroker.getLedger();
    res.json({ balance });
  } else {
    res.status(400).json({ error: "Invalid action" });
  }
}));

// POST /compute/ft-create-task   { provider, model, dataset, trainingParams? }
app.post("/compute/ft-create-task", wrap(async (req, res) => {
  const { provider, model, dataset, trainingParams } = req.body;
  if (!provider || !model || !dataset) return res.status(400).json({ error: "provider, model, and dataset are required" });
  const broker = await getComputeBroker();
  const task = await broker.fineTuning.createTask(provider, { model, dataset, ...(trainingParams || {}) });
  res.json({ task });
}));

// POST /compute/ft-get-task   { provider, taskId?, action? }
app.post("/compute/ft-get-task", wrap(async (req, res) => {
  const { provider, taskId, action } = req.body;
  if (!provider) return res.status(400).json({ error: "provider is required" });
  const broker = await getComputeBroker();
  if (action === "list") {
    const tasks = await broker.fineTuning.listTask(provider);
    res.json({ tasks });
  } else if (action === "log") {
    const log = await broker.fineTuning.getTaskLog(provider, taskId);
    res.json({ log });
  } else {
    const task = await broker.fineTuning.getTask(provider, taskId);
    res.json({ task });
  }
}));

// ═══════════════════════════════════════════════
// PAYROLL SCHEDULE ROUTES (via ethers + Hedera JSON-RPC)
// ═══════════════════════════════════════════════

function getVaultContract(vaultAddress) {
  const addr = vaultAddress || PAYROLL_VAULT_ADDRESS;
  const pk = process.env.HEDERA_OPERATOR_KEY;
  // Use ZG_STORAGE_PRIVATE_KEY for EVM signing on Hedera testnet relay
  const evmPk = process.env.ZG_STORAGE_PRIVATE_KEY;
  const provider = new ethers.JsonRpcProvider(HEDERA_RPC_URL);
  const wallet = evmPk ? new ethers.Wallet(evmPk, provider) : provider;
  // Minimal payroll vault ABI for the functions we need
  const abi = [
    "function addAgent(address agent, string name, uint256 amountPerPeriod, uint256 intervalSeconds) returns (uint256)",
    "function removeAgent(uint256 idx)",
    "function updateAgent(uint256 idx, uint256 newAmount, uint256 newInterval)",
    "function startPayroll(uint256 agentIdx)",
    "function cancelPayroll(uint256 agentIdx)",
    "function retryPayroll(uint256 agentIdx)",
    "function executePayroll(uint256 agentIdx)",
    "function fundVault() payable",
    "function fundVaultToken(uint256 amount)",
    "function setDefaultAmount(uint256 _amount)",
    "function setDefaultInterval(uint256 _interval)",
    "function setPaymentToken(address token)",
    "function associateToken(address token)",
    "function setGasLimit(uint256 _gasLimit)",
    "function withdrawExcess(uint256 amount)",
    "function getAgent(uint256 idx) view returns (tuple(address agent, uint256 amountPerPeriod, uint256 intervalSeconds, uint256 nextPaymentTime, address currentScheduleAddr, uint8 status, uint256 totalPaid, uint256 paymentCount, bool active, string agentName))",
    "function getAgentCount() view returns (uint256)",
    "function getAllAgents() view returns (tuple(address agent, uint256 amountPerPeriod, uint256 intervalSeconds, uint256 nextPaymentTime, address currentScheduleAddr, uint8 status, uint256 totalPaid, uint256 paymentCount, bool active, string agentName)[])",
    "function getVaultBalance() view returns (uint256)",
    "function getTokenBalance() view returns (uint256)",
    "function getRecentHistory(uint256 count) view returns (tuple(uint256 agentIdx, address scheduleAddress, uint256 scheduledTime, uint256 createdAt, uint256 executedAt, uint8 status)[])",
    "function getScheduleHistoryCount() view returns (uint256)",
    "function defaultAmount() view returns (uint256)",
    "function defaultInterval() view returns (uint256)",
    "function paymentToken() view returns (address)",
    "function owner() view returns (address)",
    "function scheduledCallGasLimit() view returns (uint256)",
  ];
  return new ethers.Contract(addr, abi, wallet);
}

// POST /schedule/status   { vaultAddress? }
app.post("/schedule/status", wrap(async (req, res) => {
  const vault = getVaultContract(req.body.vaultAddress);
  const [balance, owner, defaultAmount, defaultInterval, paymentToken, gasLimit, agents, history] = await Promise.all([
    vault.getVaultBalance(),
    vault.owner(),
    vault.defaultAmount(),
    vault.defaultInterval(),
    vault.paymentToken(),
    vault.scheduledCallGasLimit(),
    vault.getAllAgents(),
    vault.getRecentHistory(20),
  ]);
  res.json({
    balance: balance.toString(),
    owner,
    defaultAmount: defaultAmount.toString(),
    defaultInterval: defaultInterval.toString(),
    paymentToken,
    gasLimit: gasLimit.toString(),
    agents: agents.map((a) => ({
      agent: a.agent,
      name: a.agentName,
      amountPerPeriod: a.amountPerPeriod.toString(),
      intervalSeconds: a.intervalSeconds.toString(),
      nextPaymentTime: a.nextPaymentTime.toString(),
      status: a.status,
      totalPaid: a.totalPaid.toString(),
      paymentCount: a.paymentCount.toString(),
      active: a.active,
    })),
    history: history.map((h) => ({
      agentIdx: h.agentIdx.toString(),
      scheduleAddress: h.scheduleAddress,
      scheduledTime: h.scheduledTime.toString(),
      createdAt: h.createdAt.toString(),
      executedAt: h.executedAt.toString(),
      status: h.status,
    })),
  });
}));

// POST /schedule/add-agent   { agent, name, amountPerPeriod?, intervalSeconds?, vaultAddress? }
app.post("/schedule/add-agent", wrap(async (req, res) => {
  const { agent, name, amountPerPeriod, intervalSeconds, vaultAddress } = req.body;
  if (!agent || !name) return res.status(400).json({ error: "agent and name are required" });
  const vault = getVaultContract(vaultAddress);
  const amount = amountPerPeriod ? ethers.parseEther(String(amountPerPeriod)) : await vault.defaultAmount();
  const interval = intervalSeconds || (await vault.defaultInterval());
  const tx = await vault.addAgent(agent, name, amount, interval);
  const receipt = await tx.wait();
  res.json({ txHash: receipt.hash, status: "success" });
}));

// POST /schedule/remove-agent   { agentIdx, vaultAddress? }
app.post("/schedule/remove-agent", wrap(async (req, res) => {
  const { agentIdx, vaultAddress } = req.body;
  if (agentIdx === undefined) return res.status(400).json({ error: "agentIdx is required" });
  const vault = getVaultContract(vaultAddress);
  const tx = await vault.removeAgent(agentIdx);
  const receipt = await tx.wait();
  res.json({ txHash: receipt.hash, status: "success" });
}));

// POST /schedule/update-agent   { agentIdx, amountPerPeriod?, intervalSeconds?, vaultAddress? }
app.post("/schedule/update-agent", wrap(async (req, res) => {
  const { agentIdx, amountPerPeriod, intervalSeconds, vaultAddress } = req.body;
  if (agentIdx === undefined) return res.status(400).json({ error: "agentIdx is required" });
  const vault = getVaultContract(vaultAddress);
  const agent = await vault.getAgent(agentIdx);
  const amount = amountPerPeriod ? ethers.parseEther(String(amountPerPeriod)) : agent.amountPerPeriod;
  const interval = intervalSeconds || agent.intervalSeconds;
  const tx = await vault.updateAgent(agentIdx, amount, interval);
  const receipt = await tx.wait();
  res.json({ txHash: receipt.hash, status: "success" });
}));

// POST /schedule/start-payroll   { agentIdx, vaultAddress? }
app.post("/schedule/start-payroll", wrap(async (req, res) => {
  const { agentIdx, vaultAddress } = req.body;
  if (agentIdx === undefined) return res.status(400).json({ error: "agentIdx is required" });
  const vault = getVaultContract(vaultAddress);
  const tx = await vault.startPayroll(agentIdx);
  const receipt = await tx.wait();
  res.json({ txHash: receipt.hash, status: "success" });
}));

// POST /schedule/cancel-payroll   { agentIdx, vaultAddress? }
app.post("/schedule/cancel-payroll", wrap(async (req, res) => {
  const { agentIdx, vaultAddress } = req.body;
  if (agentIdx === undefined) return res.status(400).json({ error: "agentIdx is required" });
  const vault = getVaultContract(vaultAddress);
  const tx = await vault.cancelPayroll(agentIdx);
  const receipt = await tx.wait();
  res.json({ txHash: receipt.hash, status: "success" });
}));

// POST /schedule/retry-payroll   { agentIdx, vaultAddress? }
app.post("/schedule/retry-payroll", wrap(async (req, res) => {
  const { agentIdx, vaultAddress } = req.body;
  if (agentIdx === undefined) return res.status(400).json({ error: "agentIdx is required" });
  const vault = getVaultContract(vaultAddress);
  const tx = await vault.retryPayroll(agentIdx);
  const receipt = await tx.wait();
  res.json({ txHash: receipt.hash, status: "success" });
}));

// POST /schedule/fund   { amount, vaultAddress? }
app.post("/schedule/fund", wrap(async (req, res) => {
  const { amount, vaultAddress } = req.body;
  if (!amount) return res.status(400).json({ error: "amount (in HBAR) is required" });
  const vault = getVaultContract(vaultAddress);
  const tx = await vault.fundVault({ value: ethers.parseEther(String(amount)) });
  const receipt = await tx.wait();
  res.json({ txHash: receipt.hash, status: "success" });
}));

// POST /schedule/fund-token   { amount, vaultAddress? }
app.post("/schedule/fund-token", wrap(async (req, res) => {
  const { amount, vaultAddress } = req.body;
  if (!amount) return res.status(400).json({ error: "amount is required" });
  const vault = getVaultContract(vaultAddress);
  const tx = await vault.fundVaultToken(ethers.parseUnits(String(amount), 6));
  const receipt = await tx.wait();
  res.json({ txHash: receipt.hash, status: "success" });
}));

// POST /schedule/set-defaults   { defaultAmountHbar?, defaultInterval?, vaultAddress? }
app.post("/schedule/set-defaults", wrap(async (req, res) => {
  const { defaultAmountHbar, defaultInterval, vaultAddress } = req.body;
  const vault = getVaultContract(vaultAddress);
  const results = [];
  if (defaultAmountHbar) {
    const tx = await vault.setDefaultAmount(ethers.parseEther(String(defaultAmountHbar)));
    await tx.wait();
    results.push("defaultAmount updated");
  }
  if (defaultInterval) {
    const tx = await vault.setDefaultInterval(defaultInterval);
    await tx.wait();
    results.push("defaultInterval updated");
  }
  res.json({ status: "success", updated: results });
}));

// POST /schedule/set-token   { tokenAddress, vaultAddress? }
app.post("/schedule/set-token", wrap(async (req, res) => {
  const { tokenAddress, vaultAddress } = req.body;
  const vault = getVaultContract(vaultAddress);
  if (tokenAddress) {
    try { const tx = await vault.associateToken(tokenAddress); await tx.wait(); } catch {}
    const tx = await vault.setPaymentToken(tokenAddress);
    await tx.wait();
    res.json({ status: "success", paymentToken: tokenAddress });
  } else {
    const tx = await vault.setPaymentToken(ethers.ZeroAddress);
    await tx.wait();
    res.json({ status: "success", paymentToken: "HBAR (native)" });
  }
}));

// ═══════════════════════════════════════════════
// SUBSCRIPTION ROUTES
// ═══════════════════════════════════════════════

function getSubscriptionContract(vaultAddress) {
  const addr = vaultAddress || PAYROLL_VAULT_ADDRESS;
  const evmPk = process.env.ZG_STORAGE_PRIVATE_KEY;
  const provider = new ethers.JsonRpcProvider(HEDERA_RPC_URL);
  const wallet = evmPk ? new ethers.Wallet(evmPk, provider) : provider;
  const abi = [
    "function subscribeHbar(string name, uint256 amountPerPeriod, uint256 intervalSeconds) payable returns (uint256)",
    "function subscribeToken(address token, string name, uint256 amountPerPeriod, uint256 intervalSeconds) returns (uint256)",
    "function topUpSubscription(uint256 subIdx) payable",
    "function startSubscription(uint256 subIdx)",
    "function executeSubscription(uint256 subIdx)",
    "function cancelSubscription(uint256 subIdx)",
    "function retrySubscription(uint256 subIdx)",
    "function updateSubscription(uint256 subIdx, uint256 newAmount, uint256 newInterval)",
    "function associateToken(address token)",
    "function setGasLimit(uint256 _gasLimit)",
    "function withdrawSubHbar(uint256 amount)",
    "function withdrawSubTokens(address token, uint256 amount)",
    "function getSubscriptionCount() view returns (uint256)",
    "function getSubscription(uint256 idx) view returns (tuple(address subscriber, uint256 amountPerPeriod, uint256 intervalSeconds, uint256 nextPaymentTime, address currentScheduleAddr, uint8 status, uint256 totalPaid, uint256 paymentCount, bool active, string name, uint8 mode, address token))",
    "function getAllSubscriptions() view returns (tuple(address subscriber, uint256 amountPerPeriod, uint256 intervalSeconds, uint256 nextPaymentTime, address currentScheduleAddr, uint8 status, uint256 totalPaid, uint256 paymentCount, bool active, string name, uint8 mode, address token)[])",
    "function getSubHbarBalance(uint256 subIdx) view returns (uint256)",
    "function getCollectedHbar() view returns (uint256)",
    "function getSubScheduleHistoryCount() view returns (uint256)",
    "function getSubRecentHistory(uint256 count) view returns (tuple(uint256 subIdx, address scheduleAddress, uint256 scheduledTime, uint256 createdAt, uint256 executedAt, uint8 status)[])",
    "function getVaultBalance() view returns (uint256)",
    "function owner() view returns (address)",
    "function scheduledCallGasLimit() view returns (uint256)",
  ];
  return new ethers.Contract(addr, abi, wallet);
}

// GET /subscription/status?vaultAddress=...
app.get("/subscription/status", wrap(async (req, res) => {
  const vault = getSubscriptionContract(req.query.vaultAddress);
  const [balance, collected, subs, history] = await Promise.all([
    vault.getVaultBalance(),
    vault.getCollectedHbar(),
    vault.getAllSubscriptions(),
    vault.getSubRecentHistory(20),
  ]);
  res.json({
    hbarBalance: balance.toString(),
    collectedHbar: collected.toString(),
    subscriptions: subs.map((s) => ({
      subscriber: s.subscriber,
      name: s.name,
      amountPerPeriod: s.amountPerPeriod.toString(),
      intervalSeconds: s.intervalSeconds.toString(),
      nextPaymentTime: s.nextPaymentTime.toString(),
      status: s.status,
      totalPaid: s.totalPaid.toString(),
      paymentCount: s.paymentCount.toString(),
      active: s.active,
      mode: s.mode,
      token: s.token,
    })),
    history: history.map((h) => ({
      subIdx: h.subIdx.toString(),
      scheduleAddress: h.scheduleAddress,
      scheduledTime: h.scheduledTime.toString(),
      createdAt: h.createdAt.toString(),
      executedAt: h.executedAt.toString(),
      status: h.status,
    })),
  });
}));

// POST /subscription/subscribe-hbar   { name, amountPerPeriod, intervalSeconds, deposit?, vaultAddress? }
app.post("/subscription/subscribe-hbar", wrap(async (req, res) => {
  const { name, amountPerPeriod, intervalSeconds, deposit, vaultAddress } = req.body;
  if (!name || !amountPerPeriod || !intervalSeconds) return res.status(400).json({ error: "name, amountPerPeriod, and intervalSeconds are required" });
  const vault = getSubscriptionContract(vaultAddress);
  const amount = ethers.parseEther(String(amountPerPeriod));
  const dep = ethers.parseEther(String(deposit || amountPerPeriod));
  const tx = await vault.subscribeHbar(name, amount, intervalSeconds, { value: dep });
  const receipt = await tx.wait();
  res.json({ txHash: receipt.hash, status: "success" });
}));

// POST /subscription/subscribe-token   { token, name, amountPerPeriod, intervalSeconds, vaultAddress? }
app.post("/subscription/subscribe-token", wrap(async (req, res) => {
  const { token, name, amountPerPeriod, intervalSeconds, vaultAddress } = req.body;
  if (!token || !name || !amountPerPeriod || !intervalSeconds) return res.status(400).json({ error: "token, name, amountPerPeriod, and intervalSeconds are required" });
  const vault = getSubscriptionContract(vaultAddress);
  const amount = ethers.parseUnits(String(amountPerPeriod), 6);
  const tx = await vault.subscribeToken(token, name, amount, intervalSeconds);
  const receipt = await tx.wait();
  res.json({ txHash: receipt.hash, status: "success" });
}));

// POST /subscription/top-up   { subIdx, amount, vaultAddress? }
app.post("/subscription/top-up", wrap(async (req, res) => {
  const { subIdx, amount, vaultAddress } = req.body;
  if (subIdx === undefined || !amount) return res.status(400).json({ error: "subIdx and amount are required" });
  const vault = getSubscriptionContract(vaultAddress);
  const tx = await vault.topUpSubscription(subIdx, { value: ethers.parseEther(String(amount)) });
  const receipt = await tx.wait();
  res.json({ txHash: receipt.hash, status: "success" });
}));

// POST /subscription/start   { subIdx, vaultAddress? }
app.post("/subscription/start", wrap(async (req, res) => {
  const { subIdx, vaultAddress } = req.body;
  if (subIdx === undefined) return res.status(400).json({ error: "subIdx is required" });
  const vault = getSubscriptionContract(vaultAddress);
  const tx = await vault.startSubscription(subIdx);
  const receipt = await tx.wait();
  res.json({ txHash: receipt.hash, status: "success" });
}));

// POST /subscription/cancel   { subIdx, vaultAddress? }
app.post("/subscription/cancel", wrap(async (req, res) => {
  const { subIdx, vaultAddress } = req.body;
  if (subIdx === undefined) return res.status(400).json({ error: "subIdx is required" });
  const vault = getSubscriptionContract(vaultAddress);
  const tx = await vault.cancelSubscription(subIdx);
  const receipt = await tx.wait();
  res.json({ txHash: receipt.hash, status: "success" });
}));

// POST /subscription/retry   { subIdx, vaultAddress? }
app.post("/subscription/retry", wrap(async (req, res) => {
  const { subIdx, vaultAddress } = req.body;
  if (subIdx === undefined) return res.status(400).json({ error: "subIdx is required" });
  const vault = getSubscriptionContract(vaultAddress);
  const tx = await vault.retrySubscription(subIdx);
  const receipt = await tx.wait();
  res.json({ txHash: receipt.hash, status: "success" });
}));

// POST /subscription/set-gas-limit   { gasLimit, vaultAddress? }
app.post("/subscription/set-gas-limit", wrap(async (req, res) => {
  const { gasLimit, vaultAddress } = req.body;
  if (!gasLimit || gasLimit < 400000) return res.status(400).json({ error: "gasLimit is required (minimum 400000)" });
  const vault = getSubscriptionContract(vaultAddress);
  const tx = await vault.setGasLimit(gasLimit);
  const receipt = await tx.wait();
  res.json({ txHash: receipt.hash, status: "success", gasLimit });
}));

// POST /subscription/associate-token   { token, vaultAddress? }
app.post("/subscription/associate-token", wrap(async (req, res) => {
  const { token, vaultAddress } = req.body;
  if (!token) return res.status(400).json({ error: "token is required" });
  const vault = getSubscriptionContract(vaultAddress);
  const tx = await vault.associateToken(token);
  const receipt = await tx.wait();
  res.json({ txHash: receipt.hash, status: "success" });
}));

// POST /subscription/approve-token   { token, amount, vaultAddress? }
app.post("/subscription/approve-token", wrap(async (req, res) => {
  const { token, amount, vaultAddress } = req.body;
  if (!token || !amount) return res.status(400).json({ error: "token and amount are required" });
  const evmPk = process.env.ZG_STORAGE_PRIVATE_KEY;
  const provider = new ethers.JsonRpcProvider(HEDERA_RPC_URL);
  const wallet = new ethers.Wallet(evmPk, provider);
  const erc20 = new ethers.Contract(token, ["function approve(address spender, uint256 amount) returns (bool)"], wallet);
  const addr = vaultAddress || PAYROLL_VAULT_ADDRESS;
  const tx = await erc20.approve(addr, ethers.parseUnits(String(Number(amount) * 1000), 6));
  const receipt = await tx.wait();
  res.json({ txHash: receipt.hash, status: "success" });
}));

// ═══════════════════════════════════════════════
// UTILITY ROUTE
// ═══════════════════════════════════════════════

// POST /utils/cn   { classes: ["foo", "bar", null, false] }
app.post("/utils/cn", wrap(async (req, res) => {
  const { classes } = req.body;
  res.json({ result: cn(...(classes || [])) });
}));

// ═══════════════════════════════════════════════
// INDEX / HEALTH
// ═══════════════════════════════════════════════

app.get("/", (req, res) => {
  const routes = [];
  app._router.stack.forEach((r) => {
    if (r.route) {
      const methods = Object.keys(r.route.methods).map((m) => m.toUpperCase()).join(",");
      routes.push({ method: methods, path: r.route.path });
    }
  });
  res.json({
    name: "SPARK Server",
    version: "1.0.0",
    routes,
  });
});

// ═══════════════════════════════════════════════
// START
// ═══════════════════════════════════════════════

app.listen(PORT, () => {
  console.log(`SPARK server running on http://localhost:${PORT}`);
  console.log(`Visit http://localhost:${PORT} to see all available routes`);
});
