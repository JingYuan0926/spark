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

interface SparkConfig {
  masterTopicId?: string;
  subTopics?: Record<string, string>;
}

function readConfig(): SparkConfig {
  if (existsSync(CONFIG_PATH)) {
    return JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
  }
  return {};
}

function getMasterTopicId(): string {
  const config = readConfig();
  if (!config.masterTopicId) {
    throw new Error("No master topic found. Register an agent first.");
  }
  return config.masterTopicId;
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
  voteTopicId?: string;
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
        return {
          accountId,
          botTopicId: decoded.botTopicId,
          voteTopicId: decoded.voteTopicId,
        };
      }
    } catch {
      // skip non-JSON
    }
  }

  throw new Error(
    `Account ${accountId} not found in SPARK master topic (${masterTopicId})`
  );
}

// ── Helper: resolve an agent's voteTopicId by accountId ──────────
async function resolveVoteTopicId(accountId: string): Promise<string | null> {
  const masterTopicId = getMasterTopicId();

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
        decoded.hederaAccountId === accountId &&
        decoded.voteTopicId
      ) {
        return decoded.voteTopicId as string;
      }
    } catch {
      // skip non-JSON
    }
  }

  return null;
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

// ── Helper: reconstruct task state from HCS messages ─────────────
interface TaskState {
  requester: string;
  worker: string | null;
  title: string;
  budgetHbar: number;
  status: "open" | "accepted" | "completed" | "confirmed" | "disputed";
}

function reconstructTaskState(
  taskSeqNo: string,
  messages: Array<{ decoded: Record<string, unknown>; sequenceNumber: number }>
): TaskState | null {
  let task: TaskState | null = null;

  for (const { decoded, sequenceNumber } of messages) {
    const action = decoded.action as string;

    if (
      action === "task_created" &&
      String(sequenceNumber) === taskSeqNo
    ) {
      task = {
        requester: decoded.requester as string,
        worker: (decoded.workerAccountId as string) || null,
        title: decoded.title as string,
        budgetHbar: decoded.budgetHbar as number,
        status: "open",
      };
    }

    if (!task) continue;

    if (
      action === "task_accepted" &&
      String(decoded.taskSeqNo) === taskSeqNo
    ) {
      task.status = "accepted";
      task.worker = decoded.worker as string;
    }

    if (
      action === "task_completed" &&
      String(decoded.taskSeqNo) === taskSeqNo
    ) {
      task.status = "completed";
    }

    if (
      action === "task_confirmed" &&
      String(decoded.taskSeqNo) === taskSeqNo
    ) {
      task.status = "confirmed";
    }

    if (
      action === "task_disputed" &&
      String(decoded.taskSeqNo) === taskSeqNo
    ) {
      task.status = "disputed";
    }
  }

  return task;
}

const VALID_ACTIONS = ["submit", "confirm", "dispute"] as const;
type TaskAction = (typeof VALID_ACTIONS)[number];

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "POST only" });
  }

  const { hederaPrivateKey, taskSeqNo, deliverable, action } = req.body;

  if (!hederaPrivateKey || taskSeqNo == null || !action) {
    return res.status(400).json({
      success: false,
      error: "Required: hederaPrivateKey, taskSeqNo, action",
    });
  }

  if (!VALID_ACTIONS.includes(action as TaskAction)) {
    return res.status(400).json({
      success: false,
      error: `action must be one of: ${VALID_ACTIONS.join(", ")}`,
    });
  }

  if (action === "submit" && !deliverable) {
    return res.status(400).json({
      success: false,
      error: "deliverable is required when action is 'submit'",
    });
  }

  try {
    const client = getHederaClient();
    const operatorKey = getOperatorKey();
    const operatorId = getOperatorId();
    const masterTopicId = getMasterTopicId();

    // Step 1: Resolve caller identity from private key
    const callerKey = PrivateKey.fromStringED25519(hederaPrivateKey);
    const { accountId: callerAccountId, botTopicId } =
      await resolveAgent(callerKey);

    // Step 2: Fetch all messages and reconstruct task state
    const allMessages = await fetchAllTopicMessages(masterTopicId);
    const targetSeqNo = String(taskSeqNo);
    const taskState = reconstructTaskState(targetSeqNo, allMessages);

    if (!taskState) {
      return res.status(404).json({
        success: false,
        error: `Task with sequence number ${taskSeqNo} not found`,
      });
    }

    // ── ACTION: submit ───────────────────────────────────────────
    if (action === "submit") {
      // Only the worker can submit a deliverable
      if (taskState.worker !== callerAccountId) {
        return res.status(403).json({
          success: false,
          error: "Only the assigned worker can submit a deliverable",
        });
      }

      if (taskState.status !== "accepted") {
        return res.status(400).json({
          success: false,
          error: `Cannot submit deliverable: task status is '${taskState.status}', expected 'accepted'`,
        });
      }

      // Publish task_completed to master topic (operator signs)
      const masterMsg = JSON.stringify({
        action: "task_completed",
        taskSeqNo: targetSeqNo,
        worker: callerAccountId,
        requester: taskState.requester,
        deliverable,
        timestamp: new Date().toISOString(),
      });

      const completedSeqNo = await submitToTopic(
        client,
        masterTopicId,
        masterMsg,
        operatorKey
      );

      // Log to worker's bot topic
      const botMsg = JSON.stringify({
        action: "i_completed_task",
        taskSeqNo: targetSeqNo,
        title: taskState.title,
        timestamp: new Date().toISOString(),
      });

      const botSeqNo = await submitToTopic(
        client,
        botTopicId,
        botMsg,
        callerKey
      );

      return res.status(200).json({
        success: true,
        action: "submit",
        taskSeqNo: targetSeqNo,
        worker: callerAccountId,
        completedSeqNo,
        masterTopicId,
        botTopicId,
        botSeqNo,
      });
    }

    // ── ACTION: confirm ──────────────────────────────────────────
    if (action === "confirm") {
      // Only the requester can confirm
      if (taskState.requester !== callerAccountId) {
        return res.status(403).json({
          success: false,
          error: "Only the task requester can confirm completion",
        });
      }

      if (taskState.status !== "completed") {
        return res.status(400).json({
          success: false,
          error: `Cannot confirm: task status is '${taskState.status}', expected 'completed'`,
        });
      }

      if (!taskState.worker) {
        return res.status(400).json({
          success: false,
          error: "Cannot confirm: no worker assigned to this task",
        });
      }

      // Accept feedback from request body
      const feedback = req.body.feedback as { value?: number; tags?: string[]; review?: string } | undefined;

      // Publish task_confirmed to master topic (operator signs)
      const masterMsg = JSON.stringify({
        action: "task_confirmed",
        taskSeqNo: targetSeqNo,
        requester: callerAccountId,
        worker: taskState.worker,
        budgetHbar: taskState.budgetHbar,
        feedback: feedback || null,
        timestamp: new Date().toISOString(),
      });

      const confirmedSeqNo = await submitToTopic(
        client,
        masterTopicId,
        masterMsg,
        operatorKey
      );

      // Release escrow: operator sends HBAR to worker
      const releaseTx = await new TransferTransaction()
        .addHbarTransfer(operatorId, new Hbar(-taskState.budgetHbar))
        .addHbarTransfer(taskState.worker, new Hbar(taskState.budgetHbar))
        .execute(client);

      const releaseReceipt = await releaseTx.getReceipt(client);
      const releaseTxId = releaseTx.transactionId.toString();

      if (releaseReceipt.status.toString() !== "SUCCESS") {
        throw new Error(
          `Escrow release failed: ${releaseReceipt.status}`
        );
      }

      // Mint multi-dimensional HCS-20 tokens on worker's vote topic
      let upvoteSeqNo: string | null = null;
      const mintedDimensions: string[] = ["upvote"];
      try {
        const workerVoteTopicId = await resolveVoteTopicId(taskState.worker);
        if (workerVoteTopicId) {
          // Always mint upvote + reliability (completed a task)
          const mintMessages = [
            {
              p: "hcs-20", op: "mint", tick: "upvote", amt: "1",
              to: taskState.worker, memo: `task_confirmed:${targetSeqNo}`,
              review: feedback?.review || null,
              tags: feedback?.tags || [],
              value: feedback?.value || null,
            },
            {
              p: "hcs-20", op: "mint", tick: "reliability", amt: "1",
              to: taskState.worker, memo: `task_confirmed:${targetSeqNo}`,
            },
          ];
          mintedDimensions.push("reliability");

          // Mint additional dimensions based on feedback tags
          const tagToDim: Record<string, string> = {
            accurate: "quality", thorough: "quality", "well-written": "quality",
            fast: "speed", "on-time": "speed", quick: "speed",
          };
          const dimSet = new Set(["reliability"]);
          for (const tag of (feedback?.tags || [])) {
            const dim = tagToDim[tag];
            if (dim && !dimSet.has(dim)) {
              dimSet.add(dim);
              mintedDimensions.push(dim);
              mintMessages.push({
                p: "hcs-20", op: "mint", tick: dim, amt: "1",
                to: taskState.worker, memo: `task_confirmed:${targetSeqNo}:${tag}`,
                review: null, tags: [], value: null,
              });
            }
          }

          for (const msg of mintMessages) {
            const seqNo = await submitToTopic(
              client,
              workerVoteTopicId,
              JSON.stringify(msg),
              operatorKey
            );
            if (!upvoteSeqNo) upvoteSeqNo = seqNo;
          }
        }
      } catch (err) {
        console.error("[complete-task] reputation mint failed:", err);
      }

      // Log to requester's bot topic
      const botMsg = JSON.stringify({
        action: "i_confirmed_task",
        taskSeqNo: targetSeqNo,
        worker: taskState.worker,
        budgetHbar: taskState.budgetHbar,
        timestamp: new Date().toISOString(),
      });

      const botSeqNo = await submitToTopic(
        client,
        botTopicId,
        botMsg,
        callerKey
      );

      return res.status(200).json({
        success: true,
        action: "confirm",
        taskSeqNo: targetSeqNo,
        requester: callerAccountId,
        worker: taskState.worker,
        budgetHbar: taskState.budgetHbar,
        releaseTxId,
        confirmedSeqNo,
        upvoteSeqNo,
        masterTopicId,
        botTopicId,
        botSeqNo,
      });
    }

    // ── ACTION: dispute ──────────────────────────────────────────
    if (action === "dispute") {
      // Only the requester can dispute
      if (taskState.requester !== callerAccountId) {
        return res.status(403).json({
          success: false,
          error: "Only the task requester can dispute",
        });
      }

      if (taskState.status !== "completed") {
        return res.status(400).json({
          success: false,
          error: `Cannot dispute: task status is '${taskState.status}', expected 'completed'`,
        });
      }

      // Refund escrow: operator sends HBAR back to requester
      let refundTxId: string | null = null;
      let refundError: string | null = null;
      try {
        const refundTx = await new TransferTransaction()
          .addHbarTransfer(operatorId, new Hbar(-taskState.budgetHbar))
          .addHbarTransfer(callerAccountId, new Hbar(taskState.budgetHbar))
          .execute(client);

        const refundReceipt = await refundTx.getReceipt(client);
        if (refundReceipt.status.toString() === "SUCCESS") {
          refundTxId = refundTx.transactionId.toString();
        } else {
          refundError = `Refund TX status: ${refundReceipt.status}`;
        }
      } catch (err) {
        refundError = err instanceof Error ? err.message : String(err);
        console.error("[complete-task] refund failed:", refundError);
      }

      // Publish task_disputed to master topic (operator signs)
      const masterMsg = JSON.stringify({
        action: "task_disputed",
        taskSeqNo: targetSeqNo,
        requester: callerAccountId,
        worker: taskState.worker,
        reason: deliverable || null,
        refundTxId,
        refundError,
        timestamp: new Date().toISOString(),
      });

      const disputedSeqNo = await submitToTopic(
        client,
        masterTopicId,
        masterMsg,
        operatorKey
      );

      // Log to requester's bot topic
      const botMsg = JSON.stringify({
        action: "i_disputed_task",
        taskSeqNo: targetSeqNo,
        worker: taskState.worker,
        refundTxId,
        timestamp: new Date().toISOString(),
      });

      const botSeqNo = await submitToTopic(
        client,
        botTopicId,
        botMsg,
        callerKey
      );

      return res.status(200).json({
        success: true,
        action: "dispute",
        taskSeqNo: targetSeqNo,
        requester: callerAccountId,
        worker: taskState.worker,
        refundTxId,
        refundError,
        disputedSeqNo,
        masterTopicId,
        botTopicId,
        botSeqNo,
      });
    }

    // Should never reach here due to validation above
    return res.status(400).json({
      success: false,
      error: "Invalid action",
    });
  } catch (err: unknown) {
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
