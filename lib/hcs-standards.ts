/**
 * HCS Standards Integration for SPARK
 *
 * Implements HCS-1 (file chunking), HCS-2 (registries), HCS-10 (OpenConvAI),
 * HCS-11 (agent profiles) for enhanced Hedera integration.
 */

import {
  Client,
  PrivateKey,
  TopicCreateTransaction,
  TopicMessageSubmitTransaction,
} from "@hashgraph/sdk";

const MIRROR_URL = "https://testnet.mirrornode.hedera.com";

// ── HCS-1: File Chunking ─────────────────────────────────────────
// Store large content by chunking into HCS messages (max ~1024 bytes per chunk)

const HCS1_CHUNK_SIZE = 900; // leave room for JSON wrapper

export interface HCS1UploadResult {
  topicId: string;
  chunks: number;
  contentHash: string;
}

/**
 * Upload content to an HCS topic using HCS-1 chunking standard.
 * Content is base64-encoded, split into chunks, and submitted as ordered messages.
 */
export async function hcs1Upload(
  client: Client,
  topicId: string,
  content: string,
  mimeType: string,
  signingKey: PrivateKey
): Promise<HCS1UploadResult> {
  const encoded = Buffer.from(content).toString("base64");
  const fullData = `data:${mimeType};base64,${encoded}`;
  const chunks: string[] = [];

  for (let i = 0; i < fullData.length; i += HCS1_CHUNK_SIZE) {
    chunks.push(fullData.slice(i, i + HCS1_CHUNK_SIZE));
  }

  // Calculate SHA-256 hash
  const crypto = await import("crypto");
  const hash = crypto.createHash("sha256").update(content).digest("hex");

  // Submit each chunk as an ordered HCS message
  for (let i = 0; i < chunks.length; i++) {
    const chunkMsg = JSON.stringify({ o: i, c: chunks[i] });
    const tx = await new TopicMessageSubmitTransaction()
      .setTopicId(topicId)
      .setMessage(chunkMsg)
      .freezeWith(client)
      .sign(signingKey);
    await (await tx.execute(client)).getReceipt(client);
  }

  return { topicId, chunks: chunks.length, contentHash: hash };
}

/**
 * Download and reassemble HCS-1 content from a topic.
 */
export async function hcs1Download(topicId: string): Promise<string | null> {
  const res = await fetch(
    `${MIRROR_URL}/api/v1/topics/${topicId}/messages?limit=100`
  );
  const data = await res.json();

  const chunks: { o: number; c: string }[] = [];

  for (const msg of data.messages || []) {
    try {
      const decoded = JSON.parse(
        Buffer.from(msg.message, "base64").toString("utf-8")
      );
      if (typeof decoded.o === "number" && typeof decoded.c === "string") {
        chunks.push(decoded);
      }
    } catch {
      // skip non-chunk messages
    }
  }

  if (chunks.length === 0) return null;

  // Sort by order index and reassemble
  chunks.sort((a, b) => a.o - b.o);
  const fullData = chunks.map((c) => c.c).join("");

  // Strip data URI prefix and decode base64
  const match = fullData.match(/^data:[^;]+;base64,(.+)$/);
  if (!match) return fullData; // not base64 encoded, return as-is

  return Buffer.from(match[1], "base64").toString("utf-8");
}


// ── HCS-2: Review Registry ───────────────────────────────────────
// Append-only registry for structured reviews

export interface HCS2ReviewEntry {
  p: "hcs-2";
  op: "register";
  type: "review";
  reviewId: string;
  targetAgent: string;
  reviewer: string;
  rating: number;       // 0-100
  tags: string[];
  review: string;
  context: "knowledge" | "task";
  contextId: string;    // itemId or taskSeqNo
  timestamp: string;
}

/**
 * Submit a structured review to an HCS-2 review registry topic.
 */
export async function hcs2SubmitReview(
  client: Client,
  registryTopicId: string,
  review: Omit<HCS2ReviewEntry, "p" | "op" | "type" | "timestamp">,
  signingKey: PrivateKey
): Promise<string> {
  const entry: HCS2ReviewEntry = {
    p: "hcs-2",
    op: "register",
    type: "review",
    ...review,
    timestamp: new Date().toISOString(),
  };

  const tx = await new TopicMessageSubmitTransaction()
    .setTopicId(registryTopicId)
    .setMessage(JSON.stringify(entry))
    .freezeWith(client)
    .sign(signingKey);

  const response = await tx.execute(client);
  const receipt = await response.getReceipt(client);
  return receipt.topicSequenceNumber?.toString() ?? "0";
}

/**
 * Read all reviews from an HCS-2 registry topic.
 */
export async function hcs2ReadReviews(
  registryTopicId: string,
  targetAgent?: string
): Promise<HCS2ReviewEntry[]> {
  const fetchRes: Response = await fetch(
    `${MIRROR_URL}/api/v1/topics/${registryTopicId}/messages?limit=100`
  );
  const data = await fetchRes.json();
  const reviews: HCS2ReviewEntry[] = [];

  for (const msg of data.messages || []) {
    try {
      const decoded = JSON.parse(
        Buffer.from(msg.message, "base64").toString("utf-8")
      );
      if (decoded.p === "hcs-2" && decoded.type === "review") {
        if (!targetAgent || decoded.targetAgent === targetAgent) {
          reviews.push(decoded);
        }
      }
    } catch {
      // skip
    }
  }

  return reviews;
}


// ── HCS-11: Agent Profile ────────────────────────────────────────
// Standardized agent profile metadata

export interface HCS11AgentProfile {
  version: "1.0.0";
  type: 1; // 1 = AI agent
  display_name: string;
  bio: string;
  properties: {
    domainTags: string;
    serviceOfferings: string;
    sparkNetwork: "hedera-testnet";
    hederaAccountId: string;
    botTopicId: string;
    voteTopicId: string;
  };
  inboundTopicId?: string;  // HCS-10 inbound
  outboundTopicId?: string; // HCS-10 outbound
}

/**
 * Create an HCS-11 agent profile message on the bot topic.
 */
export function createHCS11Profile(
  botId: string,
  hederaAccountId: string,
  domainTags: string,
  serviceOfferings: string,
  botTopicId: string,
  voteTopicId: string,
): HCS11AgentProfile {
  return {
    version: "1.0.0",
    type: 1,
    display_name: botId,
    bio: `SPARK agent specializing in ${domainTags}. Services: ${serviceOfferings}.`,
    properties: {
      domainTags,
      serviceOfferings,
      sparkNetwork: "hedera-testnet",
      hederaAccountId,
      botTopicId,
      voteTopicId,
    },
  };
}


// ── HCS-10: Agent Communication ──────────────────────────────────
// Agent-to-agent discovery and messaging via HCS topics

export interface HCS10RegistryEntry {
  p: "hcs-10";
  op: "register";
  agentId: string;
  hederaAccountId: string;
  profileTopicId: string;  // bot topic with HCS-11 profile
  voteTopicId: string;
  capabilities: string[];
  timestamp: string;
}

/**
 * Register agent in an HCS-10 agent registry topic.
 */
export async function hcs10RegisterAgent(
  client: Client,
  registryTopicId: string,
  agent: Omit<HCS10RegistryEntry, "p" | "op" | "timestamp">,
  signingKey: PrivateKey
): Promise<string> {
  const entry: HCS10RegistryEntry = {
    p: "hcs-10",
    op: "register",
    ...agent,
    timestamp: new Date().toISOString(),
  };

  const tx = await new TopicMessageSubmitTransaction()
    .setTopicId(registryTopicId)
    .setMessage(JSON.stringify(entry))
    .freezeWith(client)
    .sign(signingKey);

  const response = await tx.execute(client);
  const receipt = await response.getReceipt(client);
  return receipt.topicSequenceNumber?.toString() ?? "0";
}

/**
 * Discover agents from an HCS-10 registry topic.
 */
export async function hcs10DiscoverAgents(
  registryTopicId: string,
  capabilities?: string[]
): Promise<HCS10RegistryEntry[]> {
  const fetchRes: Response = await fetch(
    `${MIRROR_URL}/api/v1/topics/${registryTopicId}/messages?limit=100`
  );
  const data = await fetchRes.json();
  const agents: HCS10RegistryEntry[] = [];

  for (const msg of data.messages || []) {
    try {
      const decoded = JSON.parse(
        Buffer.from(msg.message, "base64").toString("utf-8")
      );
      if (decoded.p === "hcs-10" && decoded.op === "register") {
        if (!capabilities || capabilities.some((c) => decoded.capabilities?.includes(c))) {
          agents.push(decoded);
        }
      }
    } catch {
      // skip
    }
  }

  return agents;
}


// ── Topic Creation Helper ────────────────────────────────────────

/**
 * Create an HCS topic for a specific standard (HCS-1, HCS-2, HCS-10).
 */
export async function createStandardTopic(
  client: Client,
  memo: string,
  submitKey?: PrivateKey
): Promise<string> {
  const tx = new TopicCreateTransaction().setTopicMemo(memo);

  if (submitKey) {
    tx.setSubmitKey(submitKey.publicKey);
  }

  const response = await tx.execute(client);
  const receipt = await response.getReceipt(client);
  return receipt.topicId!.toString();
}
