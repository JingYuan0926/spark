import type { NextApiRequest, NextApiResponse } from "next";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

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

// ── Helper: fetch all messages from a topic (paginated) ──────────
async function fetchAllTopicMessages(
  topicId: string
): Promise<Array<{ decoded: Record<string, unknown>; sequenceNumber: number; consensusTimestamp: string }>> {
  const results: Array<{ decoded: Record<string, unknown>; sequenceNumber: number; consensusTimestamp: string }> = [];
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
          consensusTimestamp: msg.consensus_timestamp,
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

// ── Task lifecycle status ────────────────────────────────────────
const VALID_STATUSES = ["open", "accepted", "completed", "confirmed", "disputed", "all"] as const;
type TaskStatus = (typeof VALID_STATUSES)[number];

interface TaskEntry {
  taskSeqNo: string;
  requester: string;
  title: string;
  description: string;
  budgetHbar: number;
  requiredTags: string[];
  workerAccountId: string | null;
  worker: string | null;
  status: string;
  escrowTxId: string | null;
  deliverable: string | null;
  createdAt: string;
  acceptedAt: string | null;
  completedAt: string | null;
  confirmedAt: string | null;
  disputedAt: string | null;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "GET") {
    return res.status(405).json({ success: false, error: "GET only" });
  }

  try {
    const masterTopicId = getMasterTopicId();

    // Parse optional status filter
    const statusParam = req.query.status;
    const filterStatus: TaskStatus = statusParam
      ? (typeof statusParam === "string" ? statusParam : statusParam[0]) as TaskStatus
      : "all";

    if (!VALID_STATUSES.includes(filterStatus)) {
      return res.status(400).json({
        success: false,
        error: `status must be one of: ${VALID_STATUSES.join(", ")}`,
      });
    }

    // Fetch all messages from master topic
    const allMessages = await fetchAllTopicMessages(masterTopicId);

    // Build task state machine from HCS message sequence
    const taskMap = new Map<string, TaskEntry>();

    for (const { decoded, sequenceNumber, consensusTimestamp } of allMessages) {
      const action = decoded.action as string;

      // task_created: initialize a new task entry
      if (action === "task_created") {
        const seqNo = String(sequenceNumber);
        taskMap.set(seqNo, {
          taskSeqNo: seqNo,
          requester: decoded.requester as string,
          title: decoded.title as string,
          description: decoded.description as string,
          budgetHbar: decoded.budgetHbar as number,
          requiredTags: (decoded.requiredTags as string[]) || [],
          workerAccountId: (decoded.workerAccountId as string) || null,
          worker: null,
          status: "open",
          escrowTxId: (decoded.escrowTxId as string) || null,
          deliverable: null,
          createdAt: (decoded.timestamp as string) || consensusTimestamp,
          acceptedAt: null,
          completedAt: null,
          confirmedAt: null,
          disputedAt: null,
        });
      }

      // task_accepted: transition to accepted
      if (action === "task_accepted") {
        const seqNo = String(decoded.taskSeqNo);
        const task = taskMap.get(seqNo);
        if (task && task.status === "open") {
          task.status = "accepted";
          task.worker = decoded.worker as string;
          task.acceptedAt = (decoded.timestamp as string) || consensusTimestamp;
        }
      }

      // task_completed: transition to completed (deliverable submitted)
      if (action === "task_completed") {
        const seqNo = String(decoded.taskSeqNo);
        const task = taskMap.get(seqNo);
        if (task && task.status === "accepted") {
          task.status = "completed";
          task.deliverable = (decoded.deliverable as string) || null;
          task.completedAt = (decoded.timestamp as string) || consensusTimestamp;
        }
      }

      // task_confirmed: transition to confirmed (escrow released)
      if (action === "task_confirmed") {
        const seqNo = String(decoded.taskSeqNo);
        const task = taskMap.get(seqNo);
        if (task && task.status === "completed") {
          task.status = "confirmed";
          task.confirmedAt = (decoded.timestamp as string) || consensusTimestamp;
        }
      }

      // task_disputed: transition to disputed
      if (action === "task_disputed") {
        const seqNo = String(decoded.taskSeqNo);
        const task = taskMap.get(seqNo);
        if (task && task.status === "completed") {
          task.status = "disputed";
          task.disputedAt = (decoded.timestamp as string) || consensusTimestamp;
        }
      }
    }

    // Convert map to array and apply filter
    let tasks = Array.from(taskMap.values());

    if (filterStatus !== "all") {
      tasks = tasks.filter((t) => t.status === filterStatus);
    }

    return res.status(200).json({
      success: true,
      masterTopicId,
      filter: filterStatus,
      count: tasks.length,
      tasks,
    });
  } catch (err: unknown) {
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
