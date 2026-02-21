import type { NextApiRequest, NextApiResponse } from "next";
import {
  PrivateKey,
  TopicMessageSubmitTransaction,
} from "@hashgraph/sdk";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

import { getHederaClient } from "@/lib/hedera";

// ── Mirror Node ──────────────────────────────────────────────────
const MIRROR_URL = "https://testnet.mirrornode.hedera.com";

// ── Config ───────────────────────────────────────────────────────
const CONFIG_PATH = join(process.cwd(), "data", "spark-config.json");

function getMasterTopicId(): string | null {
  if (existsSync(CONFIG_PATH)) {
    const config = JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
    if (config.masterTopicId) return config.masterTopicId;
  }
  return null;
}

// Resolve agent's botTopicId from master topic
async function resolveBotTopicId(
  accountId: string
): Promise<string> {
  const masterTopicId = getMasterTopicId();
  if (!masterTopicId) {
    throw new Error("No master topic found. Register an agent first.");
  }

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
        return decoded.botTopicId as string;
      }
    } catch {
      // skip non-JSON
    }
  }

  throw new Error(`Agent ${accountId} not found in master topic`);
}

// Resolve account from private key
async function resolveAccount(
  key: PrivateKey
): Promise<string> {
  const publicKeyDer = key.publicKey.toString();
  const mirrorRes = await fetch(
    `${MIRROR_URL}/api/v1/accounts?account.publickey=${publicKeyDer}&limit=1`
  );
  const mirrorData = await mirrorRes.json();
  if (!mirrorData.accounts || mirrorData.accounts.length === 0) {
    throw new Error("No Hedera account found for this private key");
  }
  return mirrorData.accounts[0].account;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "POST only" });
  }

  const { hederaPrivateKey, status, metadata } = req.body;

  if (!hederaPrivateKey) {
    return res.status(400).json({
      success: false,
      error: "Required: hederaPrivateKey",
    });
  }

  try {
    const client = getHederaClient();
    const agentKey = PrivateKey.fromStringED25519(hederaPrivateKey);
    const accountId = await resolveAccount(agentKey);
    const botTopicId = await resolveBotTopicId(accountId);

    const heartbeatMsg = JSON.stringify({
      action: "heartbeat",
      status: status || "alive",
      metadata: metadata || {},
      timestamp: new Date().toISOString(),
    });

    // Bot topic has submit key = agent's key
    const tx = await new TopicMessageSubmitTransaction()
      .setTopicId(botTopicId)
      .setMessage(heartbeatMsg)
      .freezeWith(client)
      .sign(agentKey);

    const response = await tx.execute(client);
    const receipt = await response.getReceipt(client);
    const seqNo = receipt.topicSequenceNumber?.toString() ?? "0";

    return res.status(200).json({
      success: true,
      accountId,
      botTopicId,
      sequenceNumber: seqNo,
      status: status || "alive",
    });
  } catch (err: unknown) {
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
