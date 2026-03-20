import type { NextApiRequest, NextApiResponse } from "next";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

const MIRROR_URL = "https://testnet.mirrornode.hedera.com";
const CONFIG_PATH = join(process.cwd(), "data", "spark-config.json");

const KNOWLEDGE_CATEGORIES = ["scam", "blockchain", "legal", "trend", "skills"] as const;

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "GET") {
    return res.status(405).json({ success: false, error: "GET only" });
  }

  const q = (req.query.q as string || "").toLowerCase();
  const category = req.query.category as string || "";

  if (!existsSync(CONFIG_PATH)) {
    return res.status(404).json({
      success: false,
      error: "No spark-config.json found. Register an agent first.",
    });
  }

  try {
    const config = JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
    const { subTopics } = config;
    if (!subTopics) {
      return res.status(404).json({ success: false, error: "No sub-topics configured" });
    }

    // Determine which categories to scan
    const categoriesToScan = category && KNOWLEDGE_CATEGORIES.includes(category as typeof KNOWLEDGE_CATEGORIES[number])
      ? [category]
      : [...KNOWLEDGE_CATEGORIES];

    interface KnowledgeResult {
      itemId: string;
      content: string;
      category: string;
      author: string;
      status: "pending" | "approved" | "rejected";
      timestamp: string;
      topicId: string;
    }

    const results: KnowledgeResult[] = [];

    // Scan each category sub-topic
    await Promise.all(
      categoriesToScan.map(async (cat) => {
        const topicId = subTopics[cat];
        if (!topicId) return;

        const topicRes = await fetch(
          `${MIRROR_URL}/api/v1/topics/${topicId}/messages?limit=100`
        );
        const topicData = await topicRes.json();

        const submissions: Record<string, KnowledgeResult> = {};
        const approved = new Set<string>();
        const rejected = new Set<string>();

        for (const msg of topicData.messages || []) {
          try {
            const decoded = JSON.parse(
              Buffer.from(msg.message, "base64").toString("utf-8")
            );

            if (decoded.action === "knowledge_submitted") {
              submissions[decoded.itemId] = {
                itemId: decoded.itemId,
                content: decoded.content || "",
                category: cat,
                author: decoded.author || "",
                status: "pending",
                timestamp: decoded.timestamp || msg.consensus_timestamp,
                topicId,
              };
            } else if (decoded.action === "knowledge_approved") {
              approved.add(decoded.itemId);
            } else if (decoded.action === "knowledge_rejected") {
              rejected.add(decoded.itemId);
            }
          } catch {
            // skip
          }
        }

        // Set final status and filter
        for (const [itemId, item] of Object.entries(submissions)) {
          if (approved.has(itemId)) item.status = "approved";
          else if (rejected.has(itemId)) item.status = "rejected";

          // Only return approved items for search (agents want verified knowledge)
          if (item.status !== "approved") continue;

          // Filter by query if provided
          if (q && !item.content.toLowerCase().includes(q)) continue;

          results.push(item);
        }
      })
    );

    // Sort by timestamp descending (newest first)
    results.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

    return res.status(200).json({
      success: true,
      results,
      count: results.length,
      query: q || null,
      category: category || "all",
    });
  } catch (err: unknown) {
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
