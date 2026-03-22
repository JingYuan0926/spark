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

  const {
    hederaPrivateKey,
    taskSeqNo,
    action,
    message,
    proposedPrice,
    proposalSeqNo,
    accept,
  } = req.body;

  if (!hederaPrivateKey || taskSeqNo == null || !action) {
    return res.status(400).json({
      success: false,
      error: "Required: hederaPrivateKey, taskSeqNo, action (comment | propose_price | respond_price)",
    });
  }

  if (!["comment", "propose_price", "respond_price"].includes(action)) {
    return res.status(400).json({
      success: false,
      error: "action must be: comment, propose_price, or respond_price",
    });
  }

  if (!message || typeof message !== "string" || message.trim().length === 0) {
    return res.status(400).json({
      success: false,
      error: "message is required",
    });
  }

  try {
    const client = getHederaClient();
    const operatorKey = getOperatorKey();
    const masterTopicId = getMasterTopicId();

    // Resolve caller identity
    const callerKey = PrivateKey.fromStringED25519(hederaPrivateKey);
    const { accountId: callerAccountId, botTopicId } =
      await resolveAgent(callerKey);

    // Fetch all master topic messages to find the task
    const allMessages = await fetchAllTopicMessages(masterTopicId);
    const targetSeqNo = String(taskSeqNo);

    // Find the task
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

    const requester = taskCreatedMsg.decoded.requester as string;
    const budgetHbar = taskCreatedMsg.decoded.budgetHbar as number;

    // Determine current task status
    const hasAccepted = allMessages.some(
      (m) =>
        m.decoded.action === "task_accepted" &&
        String(m.decoded.taskSeqNo) === targetSeqNo
    );
    const hasCompleted = allMessages.some(
      (m) =>
        m.decoded.action === "task_completed" &&
        String(m.decoded.taskSeqNo) === targetSeqNo
    );
    const taskStatus = hasCompleted
      ? "completed"
      : hasAccepted
        ? "accepted"
        : "open";

    // ── ACTION: comment ────────────────────────────────────────
    if (action === "comment") {
      if (taskStatus !== "open" && taskStatus !== "accepted") {
        return res.status(400).json({
          success: false,
          error: "Can only comment on open or accepted tasks",
        });
      }

      const masterMsg = JSON.stringify({
        action: "task_comment",
        taskSeqNo: targetSeqNo,
        author: callerAccountId,
        message: message.trim(),
        timestamp: new Date().toISOString(),
      });

      const seqNo = await submitToTopic(
        client,
        masterTopicId,
        masterMsg,
        operatorKey
      );

      // Log to caller's bot topic
      await submitToTopic(
        client,
        botTopicId,
        JSON.stringify({
          action: "i_commented_task",
          taskSeqNo: targetSeqNo,
          title: taskCreatedMsg.decoded.title,
          message: message.trim(),
          timestamp: new Date().toISOString(),
        }),
        callerKey
      );

      return res.status(200).json({
        success: true,
        action: "task_comment",
        taskSeqNo: targetSeqNo,
        author: callerAccountId,
        seqNo,
      });
    }

    // ── ACTION: propose_price ──────────────────────────────────
    if (action === "propose_price") {
      if (taskStatus !== "open") {
        return res.status(400).json({
          success: false,
          error: "Can only propose price on open tasks",
        });
      }

      if (callerAccountId === requester) {
        return res.status(400).json({
          success: false,
          error: "Task requester cannot propose a price on their own task",
        });
      }

      if (!proposedPrice || typeof proposedPrice !== "number" || proposedPrice <= 0) {
        return res.status(400).json({
          success: false,
          error: "proposedPrice must be a positive number",
        });
      }

      const masterMsg = JSON.stringify({
        action: "task_price_proposal",
        taskSeqNo: targetSeqNo,
        worker: callerAccountId,
        proposedPrice,
        originalPrice: budgetHbar,
        message: message.trim(),
        timestamp: new Date().toISOString(),
      });

      const seqNo = await submitToTopic(
        client,
        masterTopicId,
        masterMsg,
        operatorKey
      );

      // Log to caller's bot topic
      await submitToTopic(
        client,
        botTopicId,
        JSON.stringify({
          action: "i_proposed_price",
          taskSeqNo: targetSeqNo,
          title: taskCreatedMsg.decoded.title,
          proposedPrice,
          originalPrice: budgetHbar,
          timestamp: new Date().toISOString(),
        }),
        callerKey
      );

      return res.status(200).json({
        success: true,
        action: "task_price_proposal",
        taskSeqNo: targetSeqNo,
        worker: callerAccountId,
        proposedPrice,
        originalPrice: budgetHbar,
        seqNo,
      });
    }

    // ── ACTION: respond_price ──────────────────────────────────
    if (action === "respond_price") {
      if (taskStatus !== "open") {
        return res.status(400).json({
          success: false,
          error: "Can only respond to price proposals on open tasks",
        });
      }

      if (callerAccountId !== requester) {
        return res.status(403).json({
          success: false,
          error: "Only the task requester can respond to price proposals",
        });
      }

      if (typeof accept !== "boolean") {
        return res.status(400).json({
          success: false,
          error: "accept must be a boolean (true/false)",
        });
      }

      // Verify the proposal exists
      const proposal = allMessages.find(
        (m) =>
          m.decoded.action === "task_price_proposal" &&
          String(m.decoded.taskSeqNo) === targetSeqNo &&
          (proposalSeqNo
            ? String(m.sequenceNumber) === String(proposalSeqNo)
            : true)
      );

      if (!proposal) {
        return res.status(404).json({
          success: false,
          error: "Price proposal not found for this task",
        });
      }

      const proposalWorker = proposal.decoded.worker as string;
      const proposalPrice = proposal.decoded.proposedPrice as number;

      const masterMsg = JSON.stringify({
        action: "task_price_response",
        taskSeqNo: targetSeqNo,
        requester: callerAccountId,
        proposalSeqNo: String(proposal.sequenceNumber),
        accepted: accept,
        proposalWorker,
        newBudget: accept ? proposalPrice : budgetHbar,
        message: message.trim(),
        timestamp: new Date().toISOString(),
      });

      const seqNo = await submitToTopic(
        client,
        masterTopicId,
        masterMsg,
        operatorKey
      );

      // Log to caller's bot topic
      await submitToTopic(
        client,
        botTopicId,
        JSON.stringify({
          action: "i_responded_price",
          taskSeqNo: targetSeqNo,
          title: taskCreatedMsg.decoded.title,
          accepted: accept,
          proposalWorker,
          proposedPrice: proposalPrice,
          timestamp: new Date().toISOString(),
        }),
        callerKey
      );

      return res.status(200).json({
        success: true,
        action: "task_price_response",
        taskSeqNo: targetSeqNo,
        requester: callerAccountId,
        accepted: accept,
        proposalWorker,
        proposedPrice: proposalPrice,
        newBudget: accept ? proposalPrice : budgetHbar,
        seqNo,
      });
    }

    return res.status(400).json({
      success: false,
      error: "Unknown action",
    });
  } catch (err: unknown) {
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
