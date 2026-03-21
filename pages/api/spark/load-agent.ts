import type { NextApiRequest, NextApiResponse } from "next";
import {
  AccountId,
  AccountInfoQuery,
  PrivateKey,
} from "@hashgraph/sdk";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

import { getHederaClient } from "@/lib/hedera";

const MIRROR_URL = "https://testnet.mirrornode.hedera.com";
const CONFIG_PATH = join(process.cwd(), "data", "spark-config.json");

function getMasterTopicId(): string | null {
  const envTopic = process.env.SPARK_MASTER_TOPIC_ID;
  if (envTopic) return envTopic;
  if (existsSync(CONFIG_PATH)) {
    const config = JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
    if (config.masterTopicId) return config.masterTopicId;
  }
  return null;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  // GET /api/spark/load-agent?accountId=0.0.xxx  → dashboard (read-only, public)
  // POST /api/spark/load-agent { hederaPrivateKey } → bot (derives account from key)
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ success: false, error: "GET or POST only" });
  }

  try {
    let accountId: string | null = null;

    if (req.method === "GET") {
      // Dashboard mode: just account ID
      accountId = req.query.accountId as string || null;
      if (!accountId) {
        return res.status(400).json({
          success: false,
          error: "GET requires ?accountId=0.0.xxx",
        });
      }
    } else {
      // Bot mode: derive from private key
      const { hederaPrivateKey, hederaAccountId } = req.body;
      if (!hederaPrivateKey) {
        return res.status(400).json({
          success: false,
          error: "POST requires hederaPrivateKey",
        });
      }

      const botKey = PrivateKey.fromString(hederaPrivateKey);
      accountId = hederaAccountId || null;

      if (!accountId) {
        const publicKeyDer = botKey.publicKey.toString();
        const mirrorRes = await fetch(
          `${MIRROR_URL}/api/v1/accounts?account.publickey=${publicKeyDer}&limit=1`
        );
        const mirrorData = await mirrorRes.json();
        if (!mirrorData.accounts || mirrorData.accounts.length === 0) {
          return res.status(404).json({
            success: false,
            error: "No Hedera account found for this public key",
          });
        }
        accountId = mirrorData.accounts[0].account;
      }
    }

    // Step 1: Get account info
    const client = getHederaClient();
    const accountInfo = await new AccountInfoQuery()
      .setAccountId(AccountId.fromString(accountId!))
      .execute(client);

    const evmAddress = `0x${accountInfo.contractAccountId}`;
    const hederaPublicKey = accountInfo.key?.toString() || "";
    const hbarBalance = accountInfo.balance.toBigNumber().toNumber();

    // Step 2: Token balances
    const balanceRes = await fetch(
      `${MIRROR_URL}/api/v1/accounts/${accountId}/tokens`
    );
    const balanceData = await balanceRes.json();
    const tokens = (balanceData.tokens || []).map(
      (t: { token_id: string; balance: number }) => ({
        tokenId: t.token_id,
        balance: t.balance,
      })
    );

    // Step 3: Find registration in master topic
    const masterTopicId = getMasterTopicId();
    let registration: Record<string, unknown> | null = null;

    if (masterTopicId) {
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
            registration = decoded;
            break;
          }
        } catch {
          // skip
        }
      }
    }

    if (!registration) {
      return res.status(404).json({
        success: false,
        error: `Account ${accountId} not found in SPARK network`,
      });
    }

    const botTopicId = registration.botTopicId as string;
    const voteTopicId = registration.voteTopicId as string;
    const botId = registration.botId as string;
    const domainTags = (registration.domainTags as string) || "";
    const serviceOfferings = (registration.serviceOfferings as string) || "";

    // Step 4: Bot topic messages (activity)
    const botTopicRes = await fetch(
      `${MIRROR_URL}/api/v1/topics/${botTopicId}/messages?limit=100`
    );
    const botTopicData = await botTopicRes.json();
    const botMessages: Record<string, unknown>[] = [];
    for (const msg of botTopicData.messages || []) {
      try {
        const decoded = JSON.parse(
          Buffer.from(msg.message, "base64").toString("utf-8")
        );
        botMessages.push({
          ...decoded,
          sequenceNumber: msg.sequence_number,
          timestamp: msg.consensus_timestamp,
        });
      } catch {
        // skip
      }
    }

    // Step 5: Vote topic (reputation + dimensions + reviews)
    const voteTopicRes = await fetch(
      `${MIRROR_URL}/api/v1/topics/${voteTopicId}/messages?limit=100`
    );
    const voteTopicData = await voteTopicRes.json();
    let upvotes = 0;
    let downvotes = 0;
    const dimensions: Record<string, number> = { quality: 0, speed: 0, reliability: 0 };
    const reviews: { voter: string; review: string; tags: string[]; value: number; timestamp: string }[] = [];
    for (const msg of voteTopicData.messages || []) {
      try {
        const decoded = JSON.parse(
          Buffer.from(msg.message, "base64").toString("utf-8")
        );
        if (decoded.p === "hcs-20" && decoded.op === "mint") {
          if (decoded.tick === "upvote") upvotes += Number(decoded.amt || 1);
          if (decoded.tick === "downvote") downvotes += Number(decoded.amt || 1);
          if (decoded.tick === "quality") dimensions.quality += Number(decoded.amt || 1);
          if (decoded.tick === "speed") dimensions.speed += Number(decoded.amt || 1);
          if (decoded.tick === "reliability") dimensions.reliability += Number(decoded.amt || 1);
          if (decoded.review) {
            reviews.push({
              voter: decoded.voter || "",
              review: decoded.review,
              tags: decoded.tags || [],
              value: Number(decoded.value || 0),
              timestamp: decoded.timestamp || "",
            });
          }
        }
      } catch {
        // skip
      }
    }

    return res.status(200).json({
      success: true,
      botId,
      hederaAccountId: accountId,
      hederaPublicKey,
      evmAddress,
      domainTags,
      serviceOfferings,
      hbarBalance,
      tokens,
      masterTopicId,
      botTopicId,
      voteTopicId,
      botMessages,
      botMessageCount: botMessages.length,
      upvotes,
      downvotes,
      netReputation: upvotes - downvotes,
      dimensions,
      reviews,
      registeredAt: registration.timestamp,
    });
  } catch (err: unknown) {
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
