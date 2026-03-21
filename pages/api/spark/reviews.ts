import type { NextApiRequest, NextApiResponse } from "next";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

const MIRROR_URL = "https://testnet.mirrornode.hedera.com";
const CONFIG_PATH = join(process.cwd(), "data", "spark-config.json");

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "GET") {
    return res.status(405).json({ success: false, error: "GET only" });
  }

  const targetAgent = req.query.agent as string || "";

  if (!existsSync(CONFIG_PATH)) {
    return res.status(404).json({
      success: false,
      error: "No spark-config.json found.",
    });
  }

  try {
    const config = JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
    const { masterTopicId } = config;
    if (!masterTopicId) {
      return res.status(404).json({ success: false, error: "No master topic" });
    }

    // Scan master topic for HCS-2 review entries
    const fetchRes: Response = await fetch(
      `${MIRROR_URL}/api/v1/topics/${masterTopicId}/messages?limit=100`
    );
    const data = await fetchRes.json();

    interface Review {
      reviewId: string;
      targetAgent: string;
      reviewer: string;
      rating: number;
      tags: string[];
      review: string;
      context: string;
      contextId: string;
      timestamp: string;
    }

    const reviews: Review[] = [];

    for (const msg of data.messages || []) {
      try {
        const decoded = JSON.parse(
          Buffer.from(msg.message, "base64").toString("utf-8")
        );
        if (decoded.p === "hcs-2" && decoded.type === "review") {
          if (!targetAgent || decoded.targetAgent === targetAgent) {
            reviews.push({
              reviewId: decoded.reviewId,
              targetAgent: decoded.targetAgent,
              reviewer: decoded.reviewer,
              rating: decoded.rating,
              tags: decoded.tags || [],
              review: decoded.review,
              context: decoded.context || "general",
              contextId: decoded.contextId || "",
              timestamp: decoded.timestamp,
            });
          }
        }
      } catch {
        // skip
      }
    }

    // Calculate aggregate stats
    const avgRating = reviews.length > 0
      ? reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length
      : 0;

    const tagCounts: Record<string, number> = {};
    for (const r of reviews) {
      for (const tag of r.tags) {
        tagCounts[tag] = (tagCounts[tag] || 0) + 1;
      }
    }

    return res.status(200).json({
      success: true,
      reviews,
      count: reviews.length,
      avgRating: Math.round(avgRating * 10) / 10,
      topTags: Object.entries(tagCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([tag, count]) => ({ tag, count })),
      targetAgent: targetAgent || "all",
    });
  } catch (err: unknown) {
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
