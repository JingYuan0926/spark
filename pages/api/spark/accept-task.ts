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

// ── Helper: fetch all messages from a topic (paginated) ──────────
async function fetchAllTopicMessages(
  topicId: string
): Promise<Array<{ decoded: Record<string, unknown>; sequenceNumber: number }>> {
  const results: Array<{ decoded: Record<string, unknown>; sequenceNumber: number }> = [];
  let nextLink: string | null = `${MIRROR_URL}/api/v1/topics/${topicId}/messages?limit=100`;

  while (nextLink) {
    const fetchRes: Response = await fetch(nextLink);
    const data = await fetchRes.json();

    for (const msg of data.messages || []) {
      try {
        const decoded = JSON.parse(
          Buffer.from(msg.message, "base64").toString("utf-8")
        );
        results.push({
          decoded,
          sequenceNumber: msg.sequence_number,
        });
      } catch {
        // skip non-JSON
      }
    }

    nextLink = data.links?.next
      ? `${MIRROR_URL}${data.links.next}`
      : null;
  }

  return results;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "POST only" });
  }

  const { hederaPrivateKey, taskSeqNo } = req.body;

  if (!hederaPrivateKey || taskSeqNo == null) {
    return res.status(400).json({
      success: false,
      error: "Required: hederaPrivateKey, taskSeqNo",
    });
  }

  try {
    const client = getHederaClient();
    const operatorKey = getOperatorKey();
    const masterTopicId = getMasterTopicId();

    // Step 1: Resolve worker identity from private key
    const workerKey = PrivateKey.fromStringED25519(hederaPrivateKey);
    const { accountId: workerAccountId, botTopicId } =
      await resolveAgent(workerKey);

    // Step 2: Verify task exists and is open (not already accepted)
    const allMessages = await fetchAllTopicMessages(masterTopicId);

    const targetSeqNo = String(taskSeqNo);

    // Find the task_created message
    const taskCreatedMsg = allMessages.find(
      (m) =>
        m.decoded.action === "task_created" &&
        String(m.sequenceNumber) === targetSeqNo
    );

    if (!taskCreatedMsg) {
      return res.status(404).json({
        success: false,
        error: `Task with sequence number ${taskSeqNo} not found`,
      });
    }

    // Check if task specifies a particular worker
    const specifiedWorker = taskCreatedMsg.decoded.workerAccountId as string | null;
    if (specifiedWorker && specifiedWorker !== workerAccountId) {
      return res.status(403).json({
        success: false,
        error: `Task is assigned to ${specifiedWorker}, not ${workerAccountId}`,
      });
    }

    // Check if task has already been accepted
    const alreadyAccepted = allMessages.some(
      (m) =>
        m.decoded.action === "task_accepted" &&
        String(m.decoded.taskSeqNo) === targetSeqNo
    );

    if (alreadyAccepted) {
      return res.status(409).json({
        success: false,
        error: `Task ${taskSeqNo} has already been accepted`,
      });
    }

    // Prevent the requester from accepting their own task
    const requester = taskCreatedMsg.decoded.requester as string;
    if (requester === workerAccountId) {
      return res.status(400).json({
        success: false,
        error: "Cannot accept your own task",
      });
    }

    // Step 3: Publish task_accepted to master topic (operator signs)
    const masterMsg = JSON.stringify({
      action: "task_accepted",
      taskSeqNo: targetSeqNo,
      worker: workerAccountId,
      requester,
      title: taskCreatedMsg.decoded.title,
      timestamp: new Date().toISOString(),
    });

    const acceptSeqNo = await submitToTopic(
      client,
      masterTopicId,
      masterMsg,
      operatorKey
    );

    // Step 4: Log to worker's bot topic (worker signs)
    const botMsg = JSON.stringify({
      action: "i_accepted_task",
      taskSeqNo: targetSeqNo,
      title: taskCreatedMsg.decoded.title,
      budgetHbar: taskCreatedMsg.decoded.budgetHbar,
      requester,
      timestamp: new Date().toISOString(),
    });

    const botSeqNo = await submitToTopic(
      client,
      botTopicId,
      botMsg,
      workerKey
    );

    return res.status(200).json({
      success: true,
      taskSeqNo: targetSeqNo,
      worker: workerAccountId,
      requester,
      title: taskCreatedMsg.decoded.title,
      acceptSeqNo,
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
