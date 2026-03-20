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
    title,
    description,
    budgetHbar,
    requiredTags,
    workerAccountId,
  } = req.body;

  if (!hederaPrivateKey || !title || !description || budgetHbar == null) {
    return res.status(400).json({
      success: false,
      error: "Required: hederaPrivateKey, title, description, budgetHbar",
    });
  }

  if (typeof budgetHbar !== "number" || budgetHbar <= 0) {
    return res.status(400).json({
      success: false,
      error: "budgetHbar must be a positive number",
    });
  }

  if (requiredTags && !Array.isArray(requiredTags)) {
    return res.status(400).json({
      success: false,
      error: "requiredTags must be an array of strings",
    });
  }

  try {
    const client = getHederaClient();
    const operatorKey = getOperatorKey();
    const operatorId = getOperatorId();
    const masterTopicId = getMasterTopicId();

    // Step 1: Resolve requester identity from private key
    const requesterKey = PrivateKey.fromStringED25519(hederaPrivateKey);
    const { accountId: requesterAccountId, botTopicId } =
      await resolveAgent(requesterKey);

    // Step 2: Escrow HBAR from requester to operator
    const escrowTx = await new TransferTransaction()
      .addHbarTransfer(requesterAccountId, new Hbar(-budgetHbar))
      .addHbarTransfer(operatorId, new Hbar(budgetHbar))
      .freezeWith(client)
      .sign(requesterKey);

    const escrowResponse = await escrowTx.execute(client);
    const escrowReceipt = await escrowResponse.getReceipt(client);
    const escrowTxId = escrowResponse.transactionId.toString();

    if (escrowReceipt.status.toString() !== "SUCCESS") {
      throw new Error(`Escrow transfer failed: ${escrowReceipt.status}`);
    }

    // Step 3: Publish task_created to master topic (operator signs)
    // The sequence number becomes the task ID
    const masterMsg = JSON.stringify({
      action: "task_created",
      requester: requesterAccountId,
      title,
      description,
      budgetHbar,
      requiredTags: requiredTags || [],
      workerAccountId: workerAccountId || null,
      escrowTxId,
      timestamp: new Date().toISOString(),
    });

    const taskSeqNo = await submitToTopic(
      client,
      masterTopicId,
      masterMsg,
      operatorKey
    );

    // Step 4: Log to requester's bot topic (requester signs)
    const botMsg = JSON.stringify({
      action: "i_created_task",
      taskSeqNo,
      title,
      budgetHbar,
      timestamp: new Date().toISOString(),
    });

    const botSeqNo = await submitToTopic(
      client,
      botTopicId,
      botMsg,
      requesterKey
    );

    return res.status(200).json({
      success: true,
      taskSeqNo,
      requester: requesterAccountId,
      title,
      description,
      budgetHbar,
      requiredTags: requiredTags || [],
      workerAccountId: workerAccountId || null,
      escrowTxId,
      masterTopicId,
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
