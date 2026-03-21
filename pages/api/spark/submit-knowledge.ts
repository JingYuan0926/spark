import type { NextApiRequest, NextApiResponse } from "next";
import {
  Client,
  Hbar,
  PrivateKey,
  TopicMessageSubmitTransaction,
  TransferTransaction,
} from "@hashgraph/sdk";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

import { getHederaClient, getOperatorKey, getOperatorId } from "@/lib/hedera";

// ── HIP-991: Knowledge Submission Fee ────────────────────────────
// Agents pay a small HBAR fee per knowledge submission (revenue model)
const KNOWLEDGE_FEE_HBAR = 0.5; // 0.5 HBAR per submission

// ── Mirror Node ──────────────────────────────────────────────────
const MIRROR_URL = "https://testnet.mirrornode.hedera.com";

// ── Knowledge categories ─────────────────────────────────────────
const KNOWLEDGE_CATEGORIES = ["scam", "blockchain", "legal", "trend", "skills"] as const;
type KnowledgeCategory = (typeof KNOWLEDGE_CATEGORIES)[number];

// ── Topic config persistence ─────────────────────────────────────
const CONFIG_PATH = join(process.cwd(), "data", "spark-config.json");

interface SparkConfig {
  masterTopicId?: string;
  subTopics?: Record<KnowledgeCategory, string>;
}

function readConfig(): SparkConfig {
  if (existsSync(CONFIG_PATH)) {
    return JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
  }
  return {};
}

function getTopicIds(): { masterTopicId: string; subTopics: Record<KnowledgeCategory, string> } {
  const config = readConfig();
  if (!config.masterTopicId || !config.subTopics) {
    throw new Error("No topics found. Register an agent first to auto-create them.");
  }
  return { masterTopicId: config.masterTopicId, subTopics: config.subTopics };
}

// ── Helper: submit HCS message with signing ──────────────────────
async function submitToTopic(
  client: Client,
  topicId: string,
  message: string,
  signingKey: PrivateKey
) {
  const tx = await new TopicMessageSubmitTransaction()
    .setTopicId(topicId)
    .setMessage(message)
    .freezeWith(client)
    .sign(signingKey);

  const response = await tx.execute(client);
  const receipt = await response.getReceipt(client);
  return receipt.topicSequenceNumber?.toString() ?? "0";
}

// ── Helper: resolve accountId + botTopicId from private key ──────
async function resolveAgent(botKey: PrivateKey): Promise<{
  accountId: string;
  botTopicId: string;
}> {
  const publicKeyDer = botKey.publicKey.toString();
  const { masterTopicId } = getTopicIds();

  const mirrorRes = await fetch(
    `${MIRROR_URL}/api/v1/accounts?account.publickey=${publicKeyDer}&limit=1`
  );
  const mirrorData = await mirrorRes.json();

  if (!mirrorData.accounts || mirrorData.accounts.length === 0) {
    throw new Error("No Hedera account found for this private key");
  }

  const accountId = mirrorData.accounts[0].account;

  const topicRes = await fetch(
    `${MIRROR_URL}/api/v1/topics/${masterTopicId}/messages?limit=100`
  );
  const topicData = await topicRes.json();

  for (const msg of topicData.messages || []) {
    try {
      const decoded = JSON.parse(
        Buffer.from(msg.message, "base64").toString("utf-8")
      );
      if (
        decoded.action === "agent_registered" &&
        decoded.hederaAccountId === accountId
      ) {
        return { accountId, botTopicId: decoded.botTopicId };
      }
    } catch {
      // skip
    }
  }

  throw new Error(
    `Account ${accountId} not found in SPARK master topic (${masterTopicId})`
  );
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "POST only" });
  }

  const {
    content,
    category = "",
    hederaPrivateKey,
    accessTier = "public",
  } = req.body;

  if (!content || !hederaPrivateKey) {
    return res.status(400).json({
      success: false,
      error: "Required: content, hederaPrivateKey",
    });
  }

  if (accessTier !== "public" && accessTier !== "gated") {
    return res.status(400).json({
      success: false,
      error: "accessTier must be 'public' or 'gated'",
    });
  }

  if (!category || !KNOWLEDGE_CATEGORIES.includes(category)) {
    return res.status(400).json({
      success: false,
      error: `Required: category (one of: ${KNOWLEDGE_CATEGORIES.join(", ")})`,
    });
  }

  try {
    const client = getHederaClient();
    const operatorKey = getOperatorKey();
    const { masterTopicId, subTopics } = getTopicIds();
    const categoryTopicId = subTopics[category as KnowledgeCategory];

    // Step 1: Resolve agent identity from private key
    const botKey = PrivateKey.fromStringED25519(hederaPrivateKey);
    const { accountId, botTopicId } = await resolveAgent(botKey);
    const operatorId = getOperatorId();

    const itemId = `k-${Date.now()}`;

    // Step 1b: Collect knowledge submission fee (HIP-991 revenue model)
    // Agent pays HBAR to operator for submitting knowledge to the network
    let feeTxId = "";
    try {
      const feeTx = await new TransferTransaction()
        .addHbarTransfer(accountId, new Hbar(-KNOWLEDGE_FEE_HBAR))
        .addHbarTransfer(operatorId, new Hbar(KNOWLEDGE_FEE_HBAR))
        .freezeWith(client)
        .sign(botKey);
      const feeResponse = await feeTx.execute(client);
      const feeReceipt = await feeResponse.getReceipt(client);
      feeTxId = feeResponse.transactionId.toString();
      if (feeReceipt.status.toString() !== "SUCCESS") {
        return res.status(402).json({
          success: false,
          error: `Knowledge submission fee (${KNOWLEDGE_FEE_HBAR} HBAR) payment failed`,
        });
      }
    } catch (feeErr) {
      return res.status(402).json({
        success: false,
        error: `Insufficient HBAR for submission fee (${KNOWLEDGE_FEE_HBAR} HBAR): ${feeErr instanceof Error ? feeErr.message : String(feeErr)}`,
      });
    }

    // Step 2: Log to category sub-topic (operator signs)
    // Content is stored directly in the HCS message
    const categoryMsg = JSON.stringify({
      action: "knowledge_submitted",
      itemId,
      author: accountId,
      category,
      content,
      accessTier,
      timestamp: new Date().toISOString(),
    });

    const categorySeqNo = await submitToTopic(
      client,
      categoryTopicId,
      categoryMsg,
      operatorKey
    );

    // Step 3: Log to bot topic (bot signs with its own key)
    const botMsg = JSON.stringify({
      action: "i_submitted_knowledge",
      itemId,
      category,
      timestamp: new Date().toISOString(),
    });

    const botSeqNo = await submitToTopic(
      client,
      botTopicId,
      botMsg,
      botKey
    );

    // Step 4 (gated only): Auto-approve — skip voting for demo
    let autoApproved = false;
    if (accessTier === "gated") {
      try {
        const approvedMsg = JSON.stringify({
          action: "knowledge_approved",
          itemId,
          author: accountId,
          approvedBy: ["auto-approved"],
          timestamp: new Date().toISOString(),
        });
        await submitToTopic(client, categoryTopicId, approvedMsg, operatorKey);
        autoApproved = true;
      } catch (err) {
        console.error("[submit-knowledge] auto-approve failed:", err);
      }
    }

    return res.status(200).json({
      success: true,
      itemId,
      author: accountId,
      category,
      accessTier,
      autoApproved,
      submissionFee: `${KNOWLEDGE_FEE_HBAR} HBAR`,
      feeTxId,
      categoryTopicId,
      masterTopicId,
      categorySeqNo,
      botTopicId,
      botSeqNo,
    });
  } catch (err: unknown) {
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
