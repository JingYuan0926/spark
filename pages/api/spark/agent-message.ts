import type { NextApiRequest, NextApiResponse } from "next";
import {
  Client,
  PrivateKey,
  TopicMessageSubmitTransaction,
} from "@hashgraph/sdk";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

import { getHederaClient, getOperatorKey } from "@/lib/hedera";

// ── Mirror Node ──────────────────────────────────────────────────
const MIRROR_URL = "https://testnet.mirrornode.hedera.com";

// ── Config ───────────────────────────────────────────────────────
const CONFIG_PATH = join(process.cwd(), "data", "spark-config.json");

function getMasterTopicId(): string {
  if (existsSync(CONFIG_PATH)) {
    const config = JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
    if (config.masterTopicId) return config.masterTopicId;
  }
  throw new Error("No master topic found. Register an agent first.");
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

// ── Helper: resolve sender from private key ──────────────────────
async function resolveSender(botKey: PrivateKey): Promise<{
  accountId: string;
  botTopicId: string;
}> {
  const publicKeyDer = botKey.publicKey.toString();
  const masterTopicId = getMasterTopicId();

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
      const decoded = JSON.parse(Buffer.from(msg.message, "base64").toString("utf-8"));
      if (decoded.action === "agent_registered" && decoded.hederaAccountId === accountId) {
        return { accountId, botTopicId: decoded.botTopicId };
      }
    } catch { /* skip */ }
  }
  throw new Error(`Sender ${accountId} not found in SPARK master topic`);
}

// ── Helper: find recipient's botTopicId from master topic ────────
async function findRecipientTopic(recipientAccountId: string): Promise<string> {
  const masterTopicId = getMasterTopicId();
  const topicRes = await fetch(
    `${MIRROR_URL}/api/v1/topics/${masterTopicId}/messages?limit=100`
  );
  const topicData = await topicRes.json();

  for (const msg of topicData.messages || []) {
    try {
      const decoded = JSON.parse(Buffer.from(msg.message, "base64").toString("utf-8"));
      if (decoded.action === "agent_registered" && decoded.hederaAccountId === recipientAccountId) {
        return decoded.botTopicId;
      }
    } catch { /* skip */ }
  }
  throw new Error(`Recipient ${recipientAccountId} not registered on SPARK`);
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "POST only" });
  }

  const { senderPrivateKey, recipientAccountId, message, messageType } = req.body;

  if (!senderPrivateKey || !recipientAccountId || !message) {
    return res.status(400).json({
      success: false,
      error: "Missing required fields: senderPrivateKey, recipientAccountId, message",
    });
  }

  try {
    const client = getHederaClient();
    const operatorKey = getOperatorKey();
    const senderKey = PrivateKey.fromStringDer(senderPrivateKey);

    // Resolve sender identity
    const sender = await resolveSender(senderKey);

    // Prevent self-messaging
    if (sender.accountId === recipientAccountId) {
      return res.status(400).json({ success: false, error: "Cannot message yourself" });
    }

    // Find recipient's bot topic
    const recipientBotTopicId = await findRecipientTopic(recipientAccountId);

    const timestamp = new Date().toISOString();
    const type = messageType || "agent_message";

    // 1. Send message to recipient's bot topic (operator signs — topics use submit key)
    const recipientMsg = JSON.stringify({
      action: "agent_message",
      from: sender.accountId,
      to: recipientAccountId,
      message,
      messageType: type,
      timestamp,
    });
    const recipientSeqNo = await submitToTopic(client, recipientBotTopicId, recipientMsg, operatorKey);

    // 2. Log to sender's bot topic
    const senderMsg = JSON.stringify({
      action: "i_sent_message",
      to: recipientAccountId,
      message,
      messageType: type,
      timestamp,
    });
    const senderSeqNo = await submitToTopic(client, sender.botTopicId, senderMsg, operatorKey);

    return res.status(200).json({
      success: true,
      sender: sender.accountId,
      recipient: recipientAccountId,
      recipientBotTopicId,
      recipientSeqNo,
      senderBotTopicId: sender.botTopicId,
      senderSeqNo,
      timestamp,
    });
  } catch (err: unknown) {
    const message_str = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ success: false, error: message_str });
  }
}
