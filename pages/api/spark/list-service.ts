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

// ── Helper: resolve accountId + botTopicId from private key ──────
async function resolveAgent(botKey: PrivateKey): Promise<{
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
      // skip non-JSON
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
    hederaPrivateKey,
    serviceName,
    description,
    priceHbar,
    tags,
    estimatedTime,
  } = req.body;

  if (!hederaPrivateKey || !serviceName || !description || priceHbar == null) {
    return res.status(400).json({
      success: false,
      error: "Required: hederaPrivateKey, serviceName, description, priceHbar",
    });
  }

  if (typeof priceHbar !== "number" || priceHbar <= 0) {
    return res.status(400).json({
      success: false,
      error: "priceHbar must be a positive number",
    });
  }

  if (tags && !Array.isArray(tags)) {
    return res.status(400).json({
      success: false,
      error: "tags must be an array of strings",
    });
  }

  try {
    const client = getHederaClient();
    const operatorKey = getOperatorKey();
    const masterTopicId = getMasterTopicId();

    // Step 1: Resolve agent identity from private key
    const agentKey = PrivateKey.fromStringED25519(hederaPrivateKey);
    const { accountId, botTopicId } = await resolveAgent(agentKey);

    const serviceId = `svc-${Date.now()}`;

    // Step 2: Publish service_listed to master topic (operator signs)
    const masterMsg = JSON.stringify({
      action: "service_listed",
      serviceId,
      provider: accountId,
      serviceName,
      description,
      priceHbar,
      tags: tags || [],
      estimatedTime: estimatedTime || null,
      timestamp: new Date().toISOString(),
    });

    const masterSeqNo = await submitToTopic(
      client,
      masterTopicId,
      masterMsg,
      operatorKey
    );

    // Step 3: Log to bot topic (agent signs with own key)
    const botMsg = JSON.stringify({
      action: "i_listed_service",
      serviceId,
      serviceName,
      priceHbar,
      timestamp: new Date().toISOString(),
    });

    const botSeqNo = await submitToTopic(
      client,
      botTopicId,
      botMsg,
      agentKey
    );

    return res.status(200).json({
      success: true,
      serviceId,
      provider: accountId,
      serviceName,
      description,
      priceHbar,
      tags: tags || [],
      estimatedTime: estimatedTime || null,
      masterTopicId,
      masterSeqNo,
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
