import type { NextApiRequest, NextApiResponse } from "next";
import { PrivateKey, TopicMessageSubmitTransaction } from "@hashgraph/sdk";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

import { getHederaClient, getOperatorKey } from "@/lib/hedera";

const MIRROR_URL = "https://testnet.mirrornode.hedera.com";
const CONFIG_PATH = join(process.cwd(), "data", "spark-config.json");

function getMasterTopicId(): string | null {
  if (existsSync(CONFIG_PATH)) {
    const config = JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
    return config.masterTopicId || null;
  }
  return null;
}

async function resolveAccount(key: PrivateKey): Promise<string> {
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

  const {
    hederaPrivateKey,
    targetAgent,
    rating,
    tags = [],
    review,
    context = "general",
    contextId = "",
  } = req.body;

  if (!hederaPrivateKey || !targetAgent || !review) {
    return res.status(400).json({
      success: false,
      error: "Required: hederaPrivateKey, targetAgent (accountId), review",
    });
  }

  if (rating !== undefined && (rating < 0 || rating > 100)) {
    return res.status(400).json({
      success: false,
      error: "rating must be 0-100",
    });
  }

  try {
    const client = getHederaClient();
    const operatorKey = getOperatorKey();
    const reviewerKey = PrivateKey.fromStringED25519(hederaPrivateKey);
    const reviewerAccountId = await resolveAccount(reviewerKey);

    const masterTopicId = getMasterTopicId();
    if (!masterTopicId) {
      return res.status(400).json({
        success: false,
        error: "No master topic found. Register an agent first.",
      });
    }

    // Self-review check
    if (reviewerAccountId === targetAgent) {
      return res.status(400).json({
        success: false,
        error: "Cannot review yourself",
      });
    }

    const reviewId = `r-${Date.now()}`;

    // Submit HCS-2 review to master topic
    const reviewEntry = JSON.stringify({
      p: "hcs-2",
      op: "register",
      type: "review",
      reviewId,
      targetAgent,
      reviewer: reviewerAccountId,
      rating: rating ?? 80,
      tags: Array.isArray(tags) ? tags : [],
      review,
      context,
      contextId,
      timestamp: new Date().toISOString(),
    });

    const tx = await new TopicMessageSubmitTransaction()
      .setTopicId(masterTopicId)
      .setMessage(reviewEntry)
      .freezeWith(client)
      .sign(operatorKey);

    const response = await tx.execute(client);
    const receipt = await response.getReceipt(client);
    const seqNo = receipt.topicSequenceNumber?.toString() ?? "0";

    return res.status(200).json({
      success: true,
      reviewId,
      reviewer: reviewerAccountId,
      targetAgent,
      rating: rating ?? 80,
      tags,
      masterTopicId,
      sequenceNumber: seqNo,
    });
  } catch (err: unknown) {
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
