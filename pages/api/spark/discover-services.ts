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

// ── Helper: build agent reputation from master topic messages ─────
function buildReputationMap(
  messages: Array<{ decoded: Record<string, unknown> }>
): Record<string, { upvotes: number; completedTasks: number }> {
  const rep: Record<string, { upvotes: number; completedTasks: number }> = {};

  for (const { decoded } of messages) {
    const action = decoded.action as string;

    if (action === "task_confirmed") {
      const worker = decoded.worker as string;
      if (worker) {
        if (!rep[worker]) rep[worker] = { upvotes: 0, completedTasks: 0 };
        rep[worker].completedTasks += 1;
        rep[worker].upvotes += 1;
      }
    }
  }

  return rep;
}

interface ServiceEntry {
  serviceId: string;
  provider: string;
  serviceName: string;
  description: string;
  priceHbar: number;
  tags: string[];
  estimatedTime: string | null;
  sequenceNumber: number;
  timestamp: string;
  reputation: { upvotes: number; completedTasks: number };
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

    // Parse optional tag filter
    const tagsParam = req.query.tags;
    const filterTags: string[] = tagsParam
      ? (typeof tagsParam === "string" ? tagsParam : tagsParam[0]).split(",").map((t) => t.trim().toLowerCase())
      : [];

    // Fetch all messages from master topic
    const allMessages = await fetchAllTopicMessages(masterTopicId);

    // Build reputation map from task confirmations
    const reputationMap = buildReputationMap(allMessages);

    // Collect service listings
    const services: ServiceEntry[] = [];

    for (const { decoded, sequenceNumber, consensusTimestamp } of allMessages) {
      if (decoded.action !== "service_listed") continue;

      const provider = decoded.provider as string;
      const serviceTags = (decoded.tags as string[]) || [];

      // Apply tag filter if provided
      if (filterTags.length > 0) {
        const lowerServiceTags = serviceTags.map((t) => t.toLowerCase());
        const hasMatch = filterTags.some((ft) => lowerServiceTags.includes(ft));
        if (!hasMatch) continue;
      }

      services.push({
        serviceId: decoded.serviceId as string,
        provider,
        serviceName: decoded.serviceName as string,
        description: decoded.description as string,
        priceHbar: decoded.priceHbar as number,
        tags: serviceTags,
        estimatedTime: (decoded.estimatedTime as string) || null,
        sequenceNumber,
        timestamp: (decoded.timestamp as string) || consensusTimestamp,
        reputation: reputationMap[provider] || { upvotes: 0, completedTasks: 0 },
      });
    }

    return res.status(200).json({
      success: true,
      masterTopicId,
      filters: { tags: filterTags.length > 0 ? filterTags : "none" },
      count: services.length,
      services,
    });
  } catch (err: unknown) {
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
