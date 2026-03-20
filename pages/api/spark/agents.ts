import type { NextApiRequest, NextApiResponse } from "next";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

const MIRROR_URL = "https://testnet.mirrornode.hedera.com";
const CONFIG_PATH = join(process.cwd(), "data", "spark-config.json");

interface Registration {
  hederaAccountId: string;
  botId: string;
  botTopicId: string;
  voteTopicId: string;
  evmAddress: string;
  domainTags: string;
  serviceOfferings: string;
  timestamp: string;
  [key: string]: unknown;
}

async function fetchTopicMessages(topicId: string) {
  const res = await fetch(
    `${MIRROR_URL}/api/v1/topics/${topicId}/messages?limit=100`
  );
  const data = await res.json();
  const msgs: Record<string, unknown>[] = [];
  for (const msg of data.messages || []) {
    try {
      const decoded = JSON.parse(
        Buffer.from(msg.message, "base64").toString("utf-8")
      );
      msgs.push(decoded);
    } catch {
      // skip
    }
  }
  return msgs;
}

async function fetchAgentPublicData(reg: Registration) {
  const [balanceRes, tokenRes, voteMessages, botMessages] = await Promise.all([
    fetch(`${MIRROR_URL}/api/v1/accounts/${reg.hederaAccountId}`),
    fetch(`${MIRROR_URL}/api/v1/accounts/${reg.hederaAccountId}/tokens`),
    fetchTopicMessages(reg.voteTopicId),
    fetchTopicMessages(reg.botTopicId),
  ]);

  const balanceData = await balanceRes.json();
  const tokenData = await tokenRes.json();

  const hbarBalance = balanceData.balance
    ? balanceData.balance.balance / 1e8
    : 0;

  const tokens = (tokenData.tokens || []).map(
    (t: { token_id: string; balance: number }) => ({
      tokenId: t.token_id,
      balance: t.balance,
    })
  );

  let upvotes = 0;
  let downvotes = 0;
  for (const msg of voteMessages) {
    if (msg.p === "hcs-20" && msg.op === "mint") {
      if (msg.tick === "upvote") upvotes += Number(msg.amt || 1);
      if (msg.tick === "downvote") downvotes += Number(msg.amt || 1);
    }
  }

  return {
    hederaAccountId: reg.hederaAccountId,
    botId: reg.botId,
    evmAddress: reg.evmAddress,
    domainTags: reg.domainTags || "",
    serviceOfferings: reg.serviceOfferings || "",
    botTopicId: reg.botTopicId,
    voteTopicId: reg.voteTopicId,
    hbarBalance,
    tokens,
    upvotes,
    downvotes,
    netReputation: upvotes - downvotes,
    botMessageCount: botMessages.length,
    registeredAt: reg.timestamp,
  };
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "GET") {
    return res.status(405).json({ success: false, error: "GET only" });
  }

  if (!existsSync(CONFIG_PATH)) {
    return res.status(404).json({
      success: false,
      error: "No spark-config.json found. Register an agent first.",
    });
  }

  try {
    const config = JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
    const { masterTopicId } = config;

    if (!masterTopicId) {
      return res.status(404).json({
        success: false,
        error: "Config missing masterTopicId",
      });
    }

    // Step 1: Scan master topic for all agent_registered events
    const masterMessages = await fetchTopicMessages(masterTopicId);
    const registrations: Registration[] = [];

    for (const msg of masterMessages) {
      if (msg.action === "agent_registered" && msg.hederaAccountId) {
        registrations.push(msg as unknown as Registration);
      }
    }

    if (registrations.length === 0) {
      return res.status(200).json({
        success: true,
        agents: [],
        count: 0,
      });
    }

    // Step 2: Fetch public data for each agent in parallel
    const agents = await Promise.all(
      registrations.map((reg) => fetchAgentPublicData(reg))
    );

    return res.status(200).json({
      success: true,
      agents,
      count: agents.length,
      masterTopicId,
    });
  } catch (err: unknown) {
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
